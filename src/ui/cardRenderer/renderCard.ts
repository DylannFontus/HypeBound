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
 *
 * ## The rules box is the light surface and the frame is the dark one
 *
 * That inversion is the second thing this file gets right and it is worth saying
 * out loud, because the first version got it backwards while being technically
 * correct about everything else. The box was a recess lit from 315° — and it ran
 * 4.5 at its top-left corner to 14.2 at its bottom-right, out of 255, which is a
 * 3.7% value range across four hundred by a hundred and twelve pixels. A
 * correctly lit hole is still a hole. Below it, on the cards with the least to
 * say, the band down to the frame was black as well, so about forty per cent of
 * a card carried neither information nor material.
 *
 * Hearthstone and MTG Arena both put their textbox in the light and their frame
 * in the dark, and it is the whole reason their cards read as *printed pages*
 * rather than as interface. So the box now sits in the 42–70 band with a real
 * ramp and the shared grain, it sizes itself to its text, and the scrim beneath
 * it gave eight points of opacity back to the painting. Card text contrast after
 * all three: name 17.3:1, rules 13.5:1, type line 9.6:1, collector line 8.9:1.
 */

import type { CardDef, CharacterCardDef, CurrentId, EquipmentCardDef, LeaderCardDef, LocationCardDef } from "../../engine/types";
import {
  CARD_W,
  CARD_H,
  CURRENT_PALETTE,
  FACTION_CODE,
  FACTION_COLOR,
  FACTION_INDEX,
  LAYOUT,
  RARITY_STYLE,
  frameMetal,
  frameSpecular,
  hexToRgba,
  mix,
} from "./palette";
import { bandPaths, framePath } from "./frameShapes";
import { drawCurrentIcon, drawFactionCrest } from "./icons";
import { onAssetLoaded } from "../art/assetLoader";
import { drawHatch, patternsOn } from "./hatch";
import { drawPlaceholderArt, resetCrestStamps } from "./placeholderArt";
import { getCardArt, onArtLoaded } from "../art/artLoader";
import { registerCardSurface, setCardHover, setCardTilt } from "./cardClock";
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
  displayFont,
  drawCardName,
  drawGem,
  drawLabel,
  drawNumber,
  drawRailBoss,
  edgeGradient,
  fadedRule,
  grainOver,
  innerCast,
  isTileDetail,
  litGradient,
  onCardFontsReady,
  onCardTextureReady,
  raisedPlate,
  refreshCardStyle,
  roundRectPath,
  setCardDetail,
  specularBand,
  sunkenPlate,
  type Metal,
  type Rail,
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
interface LaidText {
  size: number;
  lineHeight: number;
  lines: LaidWord[][];
  height: number;
}

/**
 * Wrap the text and report what it came to, without drawing any of it.
 *
 * Split out from the drawing because the rules box now *sizes itself* to its
 * contents, and it cannot do that while the only thing that knows how tall the
 * text is is halfway through a fill. The box asks for the layout, sets its own
 * height from it, and hands the same layout back to be drawn — one wrap, not two.
 */
function layoutRichText(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: Rect,
  steps: readonly number[]
): LaidText | null {
  const segments = parseCardText(text);
  if (segments.length === 0) return null;

  let laid: LaidText | null = null;
  for (let step = 0; step < steps.length; step++) {
    const size = steps[step]!;
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

    laid = { size, lineHeight, lines, height: lines.length * lineHeight };
    if (laid.height <= box.h) return laid;
  }
  return laid;
}

function paintRichText(
  ctx: CanvasRenderingContext2D,
  laid: LaidText,
  box: Rect,
  options: { color: string; align?: "center" | "left" }
): void {
  ctx.save();
  ctx.fillStyle = options.color;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 2;
  const startY = box.y + (box.h - laid.height) / 2 + laid.lineHeight / 2;

  laid.lines.forEach((line, index) => {
    const width = line.reduce((sum, w) => sum + w.width, 0);
    let x = options.align === "left" ? box.x : box.x + (box.w - width) / 2;
    const y = startY + index * laid.lineHeight;
    for (const word of line) {
      ctx.font = bodyFont(laid.size, word.bold, word.italic);
      ctx.fillText(word.text, x, y);
      x += word.width;
    }
  });
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
 * The metal the frame band is made of — see `palette::frameMetal`, which the
 * leader plaque now shares so that the object above the hand and the objects in
 * it are cut from the same alloy.
 */
const bandMetal = frameMetal;

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

  /**
   * The bottom scrim, and the apron that stops it being a hole.
   *
   * The scrim's job is legibility: whatever the painting does down there, the
   * name, the rules and the collector line have to sit on something that will
   * hold white text. It used to do that job by going to `#04020a` at 97%, which
   * is black, and the consequence was measured — roughly forty per cent of a
   * short-text card below the name plate carried a total luminance range of ten
   * out of two hundred and fifty-five. §1 of the bar bans a flat fill on any
   * surface larger than an icon, and a flat *black* fill is still a flat fill.
   *
   * So the scrim now bottoms out on a tinted near-black rather than a true one,
   * and an apron is laid over it: the same 315° ramp every other surface in the
   * game wears, and the same grain. It is a small amount of light — about twenty
   * five values across the diagonal — but twenty five is the difference between
   * a surface the eye can find the far edge of and a hole.
   */
  const scrimY = boardFace ? LAYOUT.boardScrimY : LAYOUT.bottomScrim.y;
  const bottom = { x: 0, y: scrimY, w: CARD_W, h: CARD_H - scrimY };
  const floor = mix(palette.abyss, "#171326", 0.55);
  const bottomGrad = ctx.createLinearGradient(0, bottom.y, 0, bottom.y + bottom.h);
  bottomGrad.addColorStop(0, "rgba(0,0,0,0)");
  /**
   * Eight points of opacity given back to the artwork.
   *
   * The scrim was 0.90 by the middle of the lower third and 0.97 at the foot,
   * which is where "the bottom of the card is a hole" came from: a card whose
   * rules box now sizes itself to its text has a band of *painting* under the
   * type line, and at 0.97 that painting was not there. The furniture that has to
   * stay readable over it — the collector line and the two stat gems — all carry
   * their own plate or their own shadow, so the scrim does not have to be opaque
   * to do its job. Measured after the change, the worst-case card text contrast
   * is still far above the 4.5:1 floor.
   */
  bottomGrad.addColorStop(0.24, hexToRgba(palette.abyss, hard ? 0.85 : 0.58));
  bottomGrad.addColorStop(0.46, hexToRgba(floor, hard ? 1 : 0.84));
  bottomGrad.addColorStop(1, hexToRgba(floor, hard ? 1 : 0.93));
  ctx.fillStyle = bottomGrad;
  ctx.fillRect(bottom.x, bottom.y, bottom.w, bottom.h);

  if (!hard) {
    const apron = { x: 0, y: scrimY + bottom.h * 0.3, w: CARD_W, h: bottom.h * 0.7 };
    ctx.fillStyle = litGradient(ctx, apron, [
      [0, "rgba(0,0,0,0.16)"],
      [0.5, hexToRgba(mix(palette.key, "#ffffff", 0.4), 0.045)],
      [1, hexToRgba(mix(palette.hi, "#ffffff", 0.3), 0.13)],
    ]);
    ctx.fillRect(apron.x, apron.y, apron.w, apron.h);
    if (!isTileDetail()) {
      const apronPath = new Path2D();
      apronPath.rect(apron.x, apron.y, apron.w, apron.h);
      grainOver(ctx, apronPath, 0.8);
    }
  }

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
 * ## Cut into the outline, and made of the frame's own metal
 *
 * Two things were wrong with the first version and they were the same thing
 * twice. It was a capsule *laid over* the band and clipped to it, so at 512
 * native it read as a flat lozenge stuck on the rail with no join; and its metal
 * came from `RARITY_STYLE.metal`, so a Halo rare — a gold Current — wore lavender
 * pills and a Halo epic wore pink ones. Two hues that belong to neither the
 * Current nor a metal, on the one surface whose entire job is to look like part
 * of the frame.
 *
 * The boss is now a shape that *leaves* the silhouette: it rises seven pixels
 * past the outer contour and tapers back into the rail at both ends, so the card
 * has a different outline at rare than at common and you can see the tier from
 * across the room. It is cut from the band's own metal one step brighter, with a
 * ridge down its length stroked by the same edge gradient the frame's step wall
 * uses, so it takes the 315° key light exactly as the metal around it does.
 *
 * Rarity's colour has not gone anywhere; it has gone where colour belongs on a
 * gilt frame — into the small stone set in the middle of the boss, alongside the
 * keyline, the mark in the name plate's cap and the word in the collector line.
 * Four accents laid over one metal, which is the division Hearthstone makes
 * between a gild and a class colour.
 *
 * The boss itself now lives in `material.ts`, because the card *back* wears four
 * of them too — a piece of hardware that says "this is a HYPEBOUND frame" cannot
 * be private to the file that draws one of the two faces.
 */

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

  /**
   * The tier's specular, laid on the metal before any of the linework.
   *
   * It goes here rather than in `drawCardMotion` because it does not move: this
   * is the *static* reflection of the fixed key light on a polished ring, and
   * the travelling sheen the clock drives is a second, separate thing crossing
   * it. A legendary that only catches the light when the animation happens to be
   * over it is a legendary that reads as an epic in every screenshot.
   */
  const spec = frameSpecular(metal.hi, card.rarity);
  if (spec) {
    specularBand(ctx, paths.band, rect, {
      strength: spec.strength,
      tint: spec.tint,
      rule: "evenodd",
      // a wider band on a wider frame, so the highlight stays optically the same
      width: 0.055 + style.band * 0.0009,
    });
  }

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

  // the two walls of the band, lit from opposite sides because they face
  // opposite ways — this is what makes it a raised ring rather than an outline
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = edgeGradient(ctx, rect, 0.46, 0.72);
  ctx.stroke(paths.outer);
  ctx.lineWidth = 2;
  ctx.strokeStyle = edgeGradient(ctx, rect, 0.32, 0.78, true);
  ctx.stroke(paths.inner);

  ctx.restore();

  /**
   * The rail bosses, drawn *outside* the clip that everything else obeys.
   *
   * They have to be: a boss that changes the card's outline cannot be drawn
   * under a clip to the outline it is changing. Drawing them last also means
   * they cover the band's own wall stroke where the two meet, which is what a
   * carved boss does — the outline steps out, runs along the face and steps back.
   * The count of them is a second, colourless channel that survives a greyscale
   * monitor and a 3:1 downsample alike: two rails at rare, three at epic, four at
   * legendary.
   */
  if (style.ornament > 0) {
    const bossMetal: Metal = {
      hi: mix(metal.hi, "#ffffff", 0.28),
      key: mix(metal.key, metal.hi, 0.3),
      lo: metal.lo,
      abyss: metal.abyss,
    };
    for (const side of railsFor(card.rarity)) {
      drawRailBoss(ctx, rect, side, style.ornament, style.band * 0.8, bossMetal, style.color);
    }
  }

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
  options: {
    sheen?: number;
    phase?: number;
    premium?: boolean;
    hover?: number;
    /** the travelling specular; off on the static pass, which does not move */
    sweep?: boolean;
    /** the rim glow; off on the ticks where nothing about it has changed */
    glow?: boolean;
  } = {}
): void {
  const current: CurrentId = card.current;
  const palette = CURRENT_PALETTE[current];
  const style = RARITY_STYLE[card.rarity];
  const rect = frameRect();
  const metal = bandMetal(current, card.rarity);
  const paths = bandPaths(palette.shape, rect, style.band);
  const sheen = options.sheen ?? 0.28;
  const hover = options.hover ?? 0;
  const lit = 1 + hover;

  /**
   * The specular crosses the **card** at tile finish and the **band** at full.
   *
   * Measured: two idle frames 2.1 seconds apart on the collection grid were
   * indistinguishable by eye, at a mean per-pixel delta of 2.8/255. The reason is
   * arithmetic rather than amplitude — the sweep was clipped to the frame band,
   * which is 21 card-space pixels wide, and a 512px card in a 168px cell is a
   * 3:1 downsample, so the entire moving surface was seven device pixels of a
   * fifty-five-thousand-pixel tile. Nothing could have made that visible.
   *
   * At tile finish the sweep therefore runs across the whole silhouette at a
   * lower amplitude: a slow light crossing the card, which is what "idle is never
   * dead" asks for and what the reference does with a collection tile. At full
   * finish the band clip comes back, because at 420px a highlight travelling the
   * metal is a better-looking thing than one travelling the artwork.
   */
  const tile = isTileDetail();
  if (options.sweep !== false) {
    ctx.save();
    if (tile) ctx.clip(paths.outer);
    else ctx.clip(paths.band, "evenodd");
    const travel = (sheen % 1) * (CARD_W + CARD_H) * 1.5 - CARD_H * 0.5;
    /**
     * The band's axis is the key light's axis, and it was not.
     *
     * It ran from `(travel − CARD_H·k, 0)` to `(travel, CARD_H)` — an angle
     * fixed by an arbitrary reach rather than by the rig, which at tile finish
     * came out at about 48° and at full finish at about 61°, so the *same*
     * highlight crossed a 168px card and a 420px card at two different angles
     * and neither of them was 315°. `tests/card-light.test.ts` exists to catch
     * exactly this and did: an oblique gradient in the card renderer that no
     * longer matched the exception registered for it.
     *
     * Deriving the start point from `TO_LIGHT` makes the sweep travel along the
     * light instead of across it. `span` is the length of the gradient's axis,
     * so the visible band — the 0.46–0.58 stop window — is about an eighth of it
     * whatever the finish, and the two sizes finally agree.
     */
    const span = CARD_H * (tile ? 1.25 : 0.85);
    const sweep = ctx.createLinearGradient(
      travel + TO_LIGHT.x * span,
      CARD_H + TO_LIGHT.y * span,
      travel,
      CARD_H
    );
    const edge = (0.1 + 0.2 * style.glow) * lit * (tile ? 0.62 : 1);
    const core = (0.12 + 0.3 * style.glow) * lit * (tile ? 0.72 : 1);
    sweep.addColorStop(0, "rgba(255,255,255,0)");
    sweep.addColorStop(0.46, hexToRgba(metal.hi, edge));
    sweep.addColorStop(0.52, hexToRgba("#ffffff", core));
    sweep.addColorStop(0.58, hexToRgba(metal.hi, edge));
    sweep.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sweep;
    ctx.fillRect(0, 0, CARD_W, CARD_H);

    // the hovered card's metal comes up a few points across the whole band, so
    // the lift the wrapper does is a lift *into the light* rather than a slide
    if (hover > 0) {
      ctx.save();
      ctx.clip(paths.band, "evenodd");
      ctx.fillStyle = hexToRgba(mix(metal.hi, "#ffffff", 0.4), 0.09 * hover);
      ctx.fillRect(0, 0, CARD_W, CARD_H);
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * The rim glow, which is a *state* and not a motion, and so is skipped on the
   * ticks where nothing about it has changed.
   *
   * It is a stroke with a ten-pixel shadow blur — a full blurred rasterisation of
   * the silhouette — and it was being paid on every one of the twelve idle
   * repaints a second even though its only input is the hover value. The static
   * pass bakes it; the moving pass redraws it only while a hover is easing.
   */
  if (options.glow !== false) {
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
  }

  if (options.premium) drawFoil(ctx, paths, options.phase ?? 0);
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
 * The Current, for a card being read at 121px: one glyph, no label, no pill.
 *
 * Seated in the frame's top rail rather than floating on the art, with the same
 * dark bezel and the same lit lip the cartouche's medallion carries, so a board
 * unit and a card in hand are recognisably wearing the same hardware at two very
 * different scales.
 */
function drawBoardCurrentMark(ctx: CanvasRenderingContext2D, current: CurrentId): void {
  const palette = CURRENT_PALETTE[current];
  const cx = CARD_W - 74;
  const cy = 72;
  const r = 40;
  const bounds: Rect = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };

  const bezel = new Path2D();
  bezel.arc(cx, cy, r, 0, Math.PI * 2);
  castShadow(ctx, bezel, 4, 0.55);

  ctx.save();
  ctx.fillStyle = litGradient(ctx, bounds, [
    [0, mix(palette.lo, "#000000", 0.2)],
    [0.55, mix(palette.abyss, "#000000", 0.35)],
    [1, mix(palette.abyss, "#000000", 0.62)],
  ]);
  ctx.fill(bezel);
  ctx.lineWidth = 3;
  ctx.strokeStyle = edgeGradient(ctx, bounds, 0.44, 0.72, true);
  ctx.stroke(bezel);
  ctx.restore();

  drawCurrentIcon(ctx, current, cx, cy, r * 0.62, mix(palette.hi, "#ffffff", 0.35));
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
    /**
     * Two steps and a floor, not three steps and a cliff.
     *
     * `[40, 33, 27]` on a 396px plate put 'Bouncer of the Vibe' at 40 and 'The
     * One Who Never Sleeps' at 27 — a 48% size difference between two units side
     * by side on the same board, which is the same defect the collection face
     * was rebuilt to remove and which arrived here by copying its ladder without
     * its width. With the plate widened to 452 the longest names in the game
     * reach the second step, and below that `drawCardName` condenses the face
     * rather than dropping the cap height again: a board unit's name is read at
     * about seven device pixels and the thing that has to hold is its *height*.
     */
    drawCardName(ctx, card.name, r.x + r.w / 2, r.y + r.h / 2 + 1, r.w - 26, [40, 34]);
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
  const room = LAYOUT.boardKeywordWidth;
  const words = card.keywords.map((id) => id.replace(/-/g, " ").toUpperCase());

  /**
   * Two keywords if two fit, one if they do not, and a smaller one before a
   * clipped one.
   *
   * The measure has to include the tracking, which `measureText` does not: a
   * canvas applies `letterSpacing` when it draws but reports the untracked width
   * unless the same spacing is set on the context first. Setting it here and
   * clearing it afterwards is the only way the fit test and the draw agree, and
   * disagreeing is how the row got out to both rims in the first place.
   */
  const fits = (text: string, size: number, tracking: number): boolean => {
    ctx.save();
    ctx.font = displayFont(size, 700);
    ctx.letterSpacing = `${tracking}px`;
    const width = ctx.measureText(text).width;
    ctx.letterSpacing = "0px";
    ctx.restore();
    return width <= room;
  };

  const pair = words.slice(0, 2).join("  ·  ");
  let text = words[0]!;
  let size = 26;
  let tracking = 3;
  if (words.length > 1 && fits(pair, 26, 3)) {
    text = pair;
  } else if (!fits(text, 26, 3)) {
    // one keyword, tightened — 'AFTERPARTY' at 22px on 2px is still eight device
    // pixels of capital at board size, which is the size the name sets at
    size = 22;
    tracking = 2;
  }

  drawLabel(ctx, text, CARD_W / 2, LAYOUT.boardKeywordY, {
    size,
    colour: hexToRgba(mix(palette.hi, "#ffffff", 0.4), 0.96),
    tracking,
    maxWidth: room,
  });
}

/**
 * The rules box, as a surface with light on it rather than a hole in the card.
 *
 * The measurement that forced this rewrite: the old box ran 4.5 at its top-left
 * corner to 14.2 at its bottom-right, out of 255. That is a 3.7% value range
 * across 408×112 card-space pixels — technically a correct recess, lit from the
 * correct direction, and *visually* a rectangle of black. Below it, on an Action
 * or a short-text card, the band down to the frame was black too, so about forty
 * per cent of the card under the name plate carried no information and no
 * material either.
 *
 * Hearthstone inverts this and it is the whole reason its cards read as printed
 * pages: the textbox is the **light** surface and the frame is the dark one, so
 * the card resolves into two masses when you squint at it. We cannot go to
 * parchment — the art is neon nightlife and a cream panel would fight it — but
 * the principle transfers exactly. The box is now a slate plate sitting in the
 * 42–70/255 range with a real 315° ramp across it and the shared grain on top,
 * which is dark enough to hold #efeaff rules text at 9:1 and light enough that
 * the eye reads a *surface* set into the frame.
 *
 * ## And it is only as tall as it needs to be
 *
 * The old box was a fixed 112px whatever it held, so 'Inspire: this gains +1/+1.'
 * sat in the middle of ninety pixels of nothing. It now takes its height from the
 * laid-out text and stops, with the collector furniture moving up under it — a
 * printed card sizes its textbox to its rules, and so does this one.
 */
function textBoxRect(ctx: CanvasRenderingContext2D, card: CardDef): { rect: Rect; laid: LaidText | null } {
  const base = LAYOUT.textBox;
  const body = [card.text?.trim() ?? "", lensText(card)].filter(Boolean).join(" ");
  const source = body.length > 0 ? body : card.flavor ? `*${card.flavor}*` : "";
  const inner = { x: base.x + 16, y: base.y + 11, w: base.w - 32, h: base.h - 22 };
  const laid = source.length > 0 ? layoutRichText(ctx, source, inner, TYPE.body) : null;
  /**
   * The box grows upward from a fixed bottom edge, not downward from a fixed top.
   *
   * Both leave the same number of spare pixels; the difference is where they end
   * up. Anchoring the top puts the gap *below* the box, between it and the
   * collector line, which is the deadest part of the card and where the black
   * void was in the first place. Anchoring the bottom puts the gap above it,
   * between the type line and the box — which is artwork, and a card showing more
   * of its painting is a card showing more of its painting.
   */
  const foot = base.y + base.h;
  const h = laid ? Math.max(LAYOUT.textBoxMin, Math.min(base.h, Math.ceil(laid.height + 26))) : LAYOUT.textBoxMin;
  return { rect: { ...base, y: foot - h, h }, laid };
}

function drawTextBox(
  ctx: CanvasRenderingContext2D,
  card: CardDef,
  current: CurrentId,
  box: { rect: Rect; laid: LaidText | null }
): void {
  const palette = CURRENT_PALETTE[current];
  const r = box.rect;
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
  const hasBody = (card.text?.trim() ?? "").length > 0 || lensText(card).length > 0;

  const path = roundRectPath(r, 11);
  /**
   * The slate the rules are printed on.
   *
   * `sunkenPlate` runs its three stops from `mix(lo, key, 0.35)` at the shadowed
   * corner down to `mix(lo, abyss, 0.55)` at the lit one — darker toward the
   * light, because that is what the near wall of a recess does — so the metal is
   * chosen to put those two ends at roughly 70 and 42 out of 255 rather than at
   * 14 and 4. A hint of the Current is mixed into it so a Tide card's box is
   * fractionally cooler than a Cinder card's, which is the same relationship the
   * frame band already has and costs nothing to carry through.
   */
  const slateLo = mix("#3b3450", palette.key, 0.14);
  sunkenPlate(ctx, path, r, {
    metal: {
      hi: mix(palette.hi, "#ffffff", 0.45),
      key: mix("#615881", palette.key, 0.16),
      lo: slateLo,
      abyss: mix(slateLo, "#100c1c", 0.62),
    },
    amplitude: 0.62,
    opacity: cardHighContrast() ? 1 : 0.97,
    grain: 0.62,
  });

  // a hairline of the Current on the recess lip, so the box belongs to the card
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = hexToRgba(palette.hi, 0.34);
  ctx.stroke(path);
  ctx.restore();

  if (box.laid) {
    const textArea = { x: r.x + 16, y: r.y + 11, w: r.w - 32, h: r.h - 22 };
    paintRichText(ctx, box.laid, textArea, {
      color: hasBody ? (cardHighContrast() ? "#ffffff" : "#f6f2ff") : hexToRgba("#f0ebff", 0.78),
    });
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
   * All four fields, on every card, and the tracking gives way instead.
   *
   * The band between the two stat gems is 252px wide and the line has to live
   * inside it. The first version answered an overflow by *dropping a field* —
   * which meant `ALG · 033 · LEGENDARY` on Madam Null sat next to
   * `AFT · 124 · COMMON · HYPEBOUND` on the card beside it, because LEGENDARY is
   * three characters longer than COMMON. A collector line that has four fields on
   * some cards and three on others is not furniture, it is a bug wearing
   * furniture's clothes, and it is worse than having none.
   *
   * Tracking is the give. It runs from the designed 1.4px down to 0.5 and then
   * the size steps 11 → 10, which between them buy about 55px — comfortably more
   * than the 11px that LEGENDARY plus HYPEBOUND costs over COMMON plus HYPEBOUND.
   * Shedding survives only as the last resort it should always have been.
   */
  const room = LAYOUT.healthChip.cx - LAYOUT.healthChip.r - 12 - (LAYOUT.attackChip.cx + LAYOUT.attackChip.r + 12);
  ctx.save();
  let text = parts.join(" · ");
  let size: number = TYPE.footer;
  let tracking = 1.4;
  const measure = (): number => {
    ctx.font = displayFont(size, 700);
    ctx.letterSpacing = `${tracking}px`;
    return ctx.measureText(text).width;
  };
  let width = measure();
  for (const [nextSize, nextTracking] of [
    [11, 1.1],
    [11, 0.85],
    [11, 0.6],
    [10, 0.6],
    [10, 0.4],
  ] as const) {
    if (width <= room) break;
    size = nextSize;
    tracking = nextTracking;
    width = measure();
  }
  // and only then, if a future rarity word is longer than any of today's
  for (const index of [3, 0]) {
    if (width <= room) break;
    parts[index] = "";
    text = parts.filter(Boolean).join(" · ");
    width = measure();
  }
  ctx.letterSpacing = "0px";
  ctx.restore();

  fadedRule(ctx, CARD_W / 2 - width / 2 - 34, CARD_W / 2 + width / 2 + 34, y - 13, palette.hi, 0.42);
  drawLabel(ctx, text, CARD_W / 2, y, { size, colour, tracking });
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
function drawFoil(
  ctx: CanvasRenderingContext2D,
  paths: { outer: Path2D; band: Path2D },
  phase: number
): void {
  const drift = (phase % 1) * 260;
  const bands = (peak: number): CanvasGradient => {
    const gradient = ctx.createLinearGradient(-drift, 0, CARD_W * 1.2 - drift, CARD_H);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const hue = (t * 300 + phase * 360) % 360;
      gradient.addColorStop(t, `hsla(${hue}, 95%, 62%, ${i % 2 === 0 ? peak : peak * 0.4})`);
    }
    return gradient;
  };

  /**
   * The grating on the metal, where a grating belongs.
   *
   * The frame band is the one part of a foil card that is *supposed* to be a
   * rainbow: it is the printed foil stock, and dodging it at a tenth of an alpha
   * lights it without touching anything a player has to read.
   */
  const travel = ((phase * 1.4) % 1) * (CARD_W + CARD_H) - CARD_H * 0.4;
  const specular = (peak: number, tinted: boolean): CanvasGradient => {
    // the same axis as the plain card's sweep, for the same reason: a specular
    // is a reflection of the key light and there is only one of those
    const span = CARD_H * 0.95;
    const sweep = ctx.createLinearGradient(
      travel + TO_LIGHT.x * span,
      CARD_H + TO_LIGHT.y * span,
      travel,
      CARD_H
    );
    sweep.addColorStop(0, "rgba(0,0,0,0)");
    sweep.addColorStop(0.4, hexToRgba(tinted ? "#7df9ff" : "#ffffff", peak * 0.24));
    sweep.addColorStop(0.5, hexToRgba("#ffffff", peak));
    sweep.addColorStop(0.6, hexToRgba(tinted ? "#ff8fd8" : "#ffffff", peak * 0.24));
    sweep.addColorStop(1, "rgba(0,0,0,0)");
    return sweep;
  };

  ctx.save();
  ctx.clip(paths.band, "evenodd");
  ctx.globalCompositeOperation = "color-dodge";
  ctx.fillStyle = bands(0.1);
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  // the loud channel lives on the metal, where a rainbow specular belongs
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = specular(0.34, true);
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.restore();

  /**
   * ...and a much weaker one over the painting, in the mode that cannot repaint
   * it.
   *
   * The previous pass ran `overlay` at 0.34 over the whole card, and the result
   * was the failure this replaces: at phases 0.3–0.6 the entire art panel washed
   * to pink, Dawnrise's black jacket came out purple, and the skin lost its value
   * structure altogether. A foil that repaints the art is a worse cosmetic than
   * one you cannot see, because it damages the thing it exists to celebrate.
   *
   * `color-dodge` is the mode that makes the mask unnecessary: it divides by one
   * minus the source, so a black pixel stays exactly black no matter what colour
   * lands on it and only pixels that are already bright move at all. At 0.06 the
   * jacket shifts by under a value and a lit shoulder picks up a hue — which is
   * what a diffraction foil does in the world. You see it on the highlights.
   */
  ctx.save();
  ctx.clip(paths.outer);
  ctx.globalCompositeOperation = "color-dodge";
  ctx.fillStyle = bands(0.06);
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  /**
   * The same specular carries on across the painting at half the strength and
   * with no hue in it at all — a sheet of glass catching the light, which is what
   * a foil *is* over the ink, rather than a coloured film laid on the ink.
   */
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = specular(0.16, false);
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

  /**
   * The card is an object sitting on the page, so it casts before it is drawn —
   * at six of lift rather than eight, because the throw is asymmetric.
   *
   * `shadowOffset` moves a shadow down by the full distance and right by the
   * throw ratio, so a lift the right edge can hold in its twenty pixels of bleed
   * is a lift the *bottom* edge cannot: measured at eight, the bottom row of the
   * canvas carried 40/255 against the right column's 9. Six brings the two into
   * line without the card losing its footing.
   */
  castShadow(ctx, paths.outer, 6, 0.5);

  drawArt(ctx, card, current, options.art ?? null, paths.outer, boardFace);
  drawFrameBand(ctx, card, current, paths);
  drawNamePlate(ctx, card, current, boardFace);
  const box = boardFace ? null : textBoxRect(ctx, card);
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
    if (box) drawTextBox(ctx, card, current, box);
    if (!tile) drawFooter(ctx, card, current, Boolean(options.art));
  }
  /**
   * What the board face wears instead of a top band.
   *
   * A minion in play has no cost — it is already paid for — so the cost gem on a
   * board card is a number that means nothing, drawn at 121px where it is nine
   * pixels across. The Current cartouche was worse: its label set at about two
   * device pixels tall, which is not small type, it is grey noise, and this is
   * the mode that exists *specifically* to strip noise. It already correctly
   * removes the type line, the rules box, the collector band and the rarity mark.
   *
   * The Current still has to be readable — it drives every targeting rule in the
   * game — so it stays as a single glyph at 44px card space, seated in a dark
   * bezel let into the frame's top rail. Hearthstone's board minion shows art, a
   * name banner, attack and health, and nothing else.
   */
  if (boardFace) {
    drawBoardCurrentMark(ctx, current);
  } else {
    // leaders are never played from hand, so they carry no Hype cost gem
    if (card.type !== "leader") drawCostGem(ctx, card.cost, current);
    drawCurrentCartouche(ctx, current);
  }

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
  } else {
    // the rim glow belongs to the static half — see `drawCardMotion`'s note
    drawCardMotion(ctx, card, { sweep: false, hover: 0 });
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

// ---------------------------------------------------------------------------
// When a card is first drawn
// ---------------------------------------------------------------------------

/**
 * How many cards may paint synchronously before the rest are deferred.
 *
 * The number that forced this: a warm lobby → collection re-entry took **4,848ms**
 * to show a populated grid, against §3a's 260–420ms budget and its 500ms
 * "this is an obstacle" threshold. Two hundred and forty-five tiles at 13.9ms
 * each is 3.4 seconds of main thread, paid in one blocking task, and the fact
 * that two hundred and twenty of those tiles were below the fold and nobody
 * would look at them for another thirty seconds made no difference at all.
 *
 * So a screen gets a synchronous allowance and then the queue takes over.
 * Twenty-eight covers a 1600×900 viewport of 185px tiles with a row to spare —
 * and covers a hand, a shop row, a deck list and a detail view outright, so
 * every screen except the collection grid behaves exactly as it did. The rest
 * paint when they come within two rows of the viewport, on the observer this
 * file already owns, with an idle sweep behind that so a tile nobody ever
 * scrolls to still ends up painted rather than blank.
 */
const SYNC_FIRST_PAINTS = 28;

/** How long the idle sweep may hold the main thread in one go. */
const IDLE_SLICE_MS = 6;

let syncLeft = SYNC_FIRST_PAINTS;
let syncResetQueued = false;
const waiting = new Set<() => void>();
let sweepQueued = false;

type IdleHost = {
  requestIdleCallback?: (cb: (deadline: { timeRemaining: () => number }) => void, opts?: { timeout: number }) => number;
};

function sweep(): void {
  sweepQueued = false;
  const start = typeof performance === "object" ? performance.now() : Date.now();
  for (const run of waiting) {
    waiting.delete(run);
    run();
    const now = typeof performance === "object" ? performance.now() : Date.now();
    if (now - start >= IDLE_SLICE_MS) break;
  }
  if (waiting.size > 0) queueSweep();
}

function queueSweep(): void {
  if (sweepQueued || typeof window === "undefined") return;
  sweepQueued = true;
  const host = window as unknown as IdleHost;
  if (typeof host.requestIdleCallback === "function") host.requestIdleCallback(() => sweep(), { timeout: 900 });
  else setTimeout(sweep, 60);
}

/**
 * Draw now if the screen still has allowance, otherwise hand the work to the
 * queue and return a function that drains it early — which is what the
 * intersection callback calls when the tile comes into view.
 */
function firstPaint(run: () => void): (() => void) | null {
  if (typeof window === "undefined" || typeof requestAnimationFrame !== "function") {
    run();
    return null;
  }
  if (!syncResetQueued) {
    syncResetQueued = true;
    requestAnimationFrame(() => {
      syncLeft = SYNC_FIRST_PAINTS;
      syncResetQueued = false;
    });
  }
  if (syncLeft > 0) {
    syncLeft -= 1;
    run();
    return null;
  }
  waiting.add(run);
  queueSweep();
  return () => {
    if (!waiting.delete(run)) return;
    run();
  };
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
    /**
     * The finish has to be set here as well as inside `renderCard`, because this
     * path never calls it: a composite is a blit plus the moving layer, and the
     * moving layer's whole shape — whether the specular crosses the card or the
     * band — depends on which finish the card underneath was drawn at.
     */
    setCardDetail(width < TILE_DETAIL_BELOW ? "tile" : "full");
    drawCardMotion(ctx, card, {
      sheen,
      phase: foil,
      premium: options.premium === true,
      hover,
      // the glow is baked into `base`; redraw it only while a hover is easing
      glow: hover > 0,
    });
    setCardDetail("full");
  };

  /**
   * The cache is consulted exactly once, on the first paint, and written on the
   * same pass. Every repaint after that — art arriving, a hover, the clock — is
   * a card whose inputs have changed, which is the one case a cache must not
   * answer.
   */
  const cacheKey = tileCacheKey(card, width, dpr, options);
  const cached = cacheKey ? tileCache.get(cacheKey) : undefined;
  let drawEarly: (() => void) | null = null;
  if (cacheKey && cached) {
    tileCache.delete(cacheKey);
    tileCache.set(cacheKey, cached);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cached, 0, 0);
  } else {
    drawEarly = firstPaint(() => {
      paint();
      if (cacheKey) rememberTile(cacheKey, canvas);
    });
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
  const unsubscribeFonts = onCardFontsReady(() => {
    dropTileCache();
    paint();
    unsubscribeFonts();
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
    // a tile whose first paint was deferred draws as it comes within two rows
    onVisible: drawEarly ?? undefined,
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

/**
 * Turn a card under the light: `x` and `y` are the pointer's offset from the
 * card's centre, each −0.5 to 0.5.
 *
 * Exported here rather than making screens import `cardClock` directly, for the
 * same reason `hoverCard` is: a screen's business is where the pointer is, and
 * the mapping from that to a phase of a diffraction grating is this domain's.
 * The two axes are weighted differently because the sweep runs diagonally — a
 * horizontal turn moves it much further across the card than a vertical one.
 */
export function tiltCard(canvas: HTMLCanvasElement, x: number, y: number): void {
  setCardTilt(canvas, x * 0.42 + y * 0.16);
}

export { CARD_W, CARD_H };
