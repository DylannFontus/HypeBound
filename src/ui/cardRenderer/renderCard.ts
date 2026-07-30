/**
 * The premium card renderer.
 *
 * Draws a complete card to a canvas: Current-shaped frame with a chrome bevel,
 * art window (owner art or a procedural placeholder), cost gem, Current badge
 * with a written label, name plate, rich rules text, stat chips, rarity gem
 * and faction crest. The same canvas feeds both the DOM screens and the
 * three.js board, so a card looks identical everywhere.
 */

import type { CardDef, CharacterCardDef, CurrentId, EquipmentCardDef, LeaderCardDef, LocationCardDef } from "../../engine/types";
import { CARD_W, CARD_H, CURRENT_PALETTE, FACTION_COLOR, LAYOUT, RARITY_STYLE, hexToRgba, mix } from "./palette";
import { traceFrame, roundedRect } from "./frameShapes";
import { drawCurrentIcon, drawFactionCrest } from "./icons";
import { onAssetLoaded } from "../art/assetLoader";
import { drawHatch, patternsOn } from "./hatch";
import { drawPlaceholderArt } from "./placeholderArt";
import { getCardArt, onArtLoaded } from "../art/artLoader";

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
   * to count at a glance.
   */
  statEmphasis?: boolean;
}

const FACTION_INDEX: Record<string, number> = {
  "neon-idols": 0,
  "gothic-royalty": 1,
  "viral-influencers": 2,
  "corporate-creators": 3,
  "digital-demons": 4,
  "cosplay-champions": 5,
  "afterparty-crew": 6,
  "touch-grass-order": 7,
  "algorithm-syndicate": 8,
  "meme-collective": 9,
  neutral: 10,
};

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

function fontFor(size: number, bold: boolean, italic: boolean): string {
  const style = italic ? "italic " : "";
  const weight = bold ? "700 " : "500 ";
  return `${style}${weight}${size}px "Segoe UI", system-ui, sans-serif`;
}

/**
 * Word-wrap rich text into a box, shrinking the font until it fits.
 * Returns the font size actually used.
 */
function drawRichText(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: { x: number; y: number; w: number; h: number },
  options: { maxSize: number; minSize: number; color: string; align?: "center" | "left" }
): void {
  const segments = parseCardText(text);
  if (segments.length === 0) return;

  for (let size = options.maxSize; size >= options.minSize; size -= 1) {
    const lineHeight = size * 1.28;
    const words: LaidWord[] = [];
    for (const segment of segments) {
      ctx.font = fontFor(size, segment.bold, segment.italic);
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
    if (totalHeight > box.h && size > options.minSize) continue;

    // draw
    ctx.fillStyle = options.color;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const startY = box.y + (box.h - totalHeight) / 2 + lineHeight / 2;

    lines.forEach((line, index) => {
      const width = line.reduce((sum, w) => sum + w.width, 0);
      let x = options.align === "left" ? box.x : box.x + (box.w - width) / 2;
      const y = startY + index * lineHeight;
      for (const word of line) {
        ctx.font = fontFor(size, word.bold, word.italic);
        ctx.fillText(word.text, x, y);
        x += word.width;
      }
    });
    return;
  }
}

/** Fit a single line of text to a width by shrinking the font. */
function drawFittedLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxWidth: number,
  maxSize: number,
  minSize: number,
  color: string,
  bold = true,
  /**
   * Outline width. A drop shadow blurs into the gem beneath at board size and
   * stops separating the glyph; an actual stroke keeps the edge hard.
   */
  outline = 0
): void {
  let size = maxSize;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (; size > minSize; size--) {
    ctx.font = fontFor(size, bold, false);
    if (ctx.measureText(text).width <= maxWidth) break;
  }
  ctx.font = fontFor(size, bold, false);
  if (outline > 0) {
    ctx.lineJoin = "round";
    ctx.lineWidth = outline;
    ctx.strokeStyle = "rgba(0,0,0,0.88)";
    ctx.strokeText(text, cx, cy);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, cx, cy);
}

// ---------------------------------------------------------------------------
// Frame pieces
// ---------------------------------------------------------------------------

/** The card silhouette, used both to clip the art and to stroke the rim. */
function frameRect(): { x: number; y: number; w: number; h: number } {
  return { x: LAYOUT.bleed, y: LAYOUT.bleed, w: CARD_W - LAYOUT.bleed * 2, h: CARD_H - LAYOUT.bleed * 2 };
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
  art: RenderCardOptions["art"]
): void {
  const palette = CURRENT_PALETTE[current];
  const rect = frameRect();

  ctx.save();
  ctx.beginPath();
  traceFrame(ctx, palette.shape, rect);
  ctx.clip();

  if (art) {
    // cover-fit so the art always fills the frame with no letterboxing
    const iw = "width" in art ? art.width : CARD_W;
    const ih = "height" in art ? art.height : CARD_H;
    const scale = Math.max(CARD_W / iw, CARD_H / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(art as CanvasImageSource, (CARD_W - dw) / 2, (CARD_H - dh) / 2, dw, dh);
  } else {
    drawPlaceholderArt(ctx, { x: 0, y: 0, w: CARD_W, h: CARD_H }, current, card.name);
  }

  // top scrim — carries the cost gem, Current badge and faction crest
  const top = LAYOUT.topScrim;
  const topGrad = ctx.createLinearGradient(0, top.y, 0, top.y + top.h);
  topGrad.addColorStop(0, hexToRgba(palette.abyss, 0.9));
  topGrad.addColorStop(0.55, hexToRgba(palette.abyss, 0.45));
  topGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = topGrad;
  ctx.fillRect(top.x, top.y, top.w, top.h);

  // bottom scrim — carries the name, rules text and stat chips
  const bottom = LAYOUT.bottomScrim;
  const bottomGrad = ctx.createLinearGradient(0, bottom.y, 0, bottom.y + bottom.h);
  bottomGrad.addColorStop(0, "rgba(0,0,0,0)");
  bottomGrad.addColorStop(0.28, hexToRgba(palette.abyss, 0.72));
  bottomGrad.addColorStop(0.55, hexToRgba("#05030c", 0.93));
  bottomGrad.addColorStop(1, hexToRgba("#04020a", 0.97));
  ctx.fillStyle = bottomGrad;
  ctx.fillRect(bottom.x, bottom.y, bottom.w, bottom.h);

  // subtle Current wash over the whole card ties art to element
  ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = hexToRgba(palette.key, 0.1);
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.globalCompositeOperation = "source-over";

  ctx.restore();
}

/** The Current-shaped rim drawn on top of the art, plus its outer neon bloom. */
function drawFrameRim(ctx: CanvasRenderingContext2D, current: CurrentId): void {
  const palette = CURRENT_PALETTE[current];
  const rect = frameRect();

  // outer bloom
  ctx.save();
  ctx.shadowColor = hexToRgba(palette.key, 0.6);
  ctx.shadowBlur = 24;
  ctx.strokeStyle = hexToRgba(palette.key, 0.9);
  ctx.lineWidth = 3;
  ctx.beginPath();
  traceFrame(ctx, palette.shape, rect);
  ctx.stroke();
  ctx.restore();

  // bright metallic edge with a darker inner line for depth
  ctx.save();
  const edge = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  edge.addColorStop(0, palette.hi);
  edge.addColorStop(0.45, palette.key);
  edge.addColorStop(1, mix(palette.lo, "#000000", 0.2));
  ctx.strokeStyle = edge;
  ctx.lineWidth = 5;
  ctx.beginPath();
  traceFrame(ctx, palette.shape, rect);
  ctx.stroke();

  ctx.strokeStyle = hexToRgba("#000000", 0.5);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  traceFrame(ctx, palette.shape, { x: rect.x + 4, y: rect.y + 4, w: rect.w - 8, h: rect.h - 8 });
  ctx.stroke();

  ctx.strokeStyle = hexToRgba(palette.hi, 0.32);
  ctx.lineWidth = 1;
  ctx.beginPath();
  traceFrame(ctx, palette.shape, { x: rect.x + 7, y: rect.y + 7, w: rect.w - 14, h: rect.h - 14 });
  ctx.stroke();
  ctx.restore();
}

function drawCostGem(ctx: CanvasRenderingContext2D, cost: number, current: CurrentId): void {
  const { cx, cy, r } = LAYOUT.costGem;
  const palette = CURRENT_PALETTE[current];

  ctx.save();
  ctx.shadowColor = hexToRgba("#7dd3ff", 0.75);
  ctx.shadowBlur = 16;

  // faceted hype crystal
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();

  const gem = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  gem.addColorStop(0, "#bfe9ff");
  gem.addColorStop(0.42, "#3aa7ff");
  gem.addColorStop(1, "#0f3f8a");
  ctx.fillStyle = gem;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = hexToRgba("#e8f7ff", 0.9);
  ctx.lineWidth = 2;
  ctx.stroke();

  // inner facet highlight
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.5, cy - r * 0.35);
  ctx.lineTo(cx, cy - r * 0.72);
  ctx.lineTo(cx + r * 0.32, cy - r * 0.3);
  ctx.closePath();
  ctx.fillStyle = hexToRgba("#ffffff", 0.42);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 4;
  drawFittedLine(ctx, String(cost), cx, cy + 1, r * 1.5, 34, 20, "#ffffff");
  ctx.restore();
  void palette;
}

function drawCurrentBadge(ctx: CanvasRenderingContext2D, current: CurrentId): void {
  const palette = CURRENT_PALETTE[current];
  const b = LAYOUT.badge;

  ctx.save();
  ctx.beginPath();
  roundedRect(ctx, b, b.h / 2);
  const grad = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
  grad.addColorStop(0, hexToRgba(palette.lo, 0.95));
  grad.addColorStop(1, hexToRgba(palette.key, 0.9));
  ctx.fillStyle = grad;
  ctx.fill();
  /**
   * §8.1's hatch fill — a fourth redundant channel behind shape, glyph and
   * label, and the only one that survives a photograph, a stream compressed to
   * mush, or a monitor with its saturation at zero. Clipped to the badge, drawn
   * before the stroke so the rim stays clean.
   */
  if (patternsOn()) {
    ctx.save();
    ctx.clip();
    drawHatch(ctx, palette.hatch, b, hexToRgba(palette.hi, 0.42));
    ctx.restore();
  }
  ctx.strokeStyle = hexToRgba(palette.hi, 0.8);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  drawCurrentIcon(ctx, current, b.x + 24, b.y + b.h / 2, 14, palette.hi);

  // the written Current name — the accessibility guarantee
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = fontFor(16, true, false);
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 3;
  ctx.letterSpacing = "1.5px";
  ctx.fillText(palette.label, b.x + 46, b.y + b.h / 2 + 1);
  ctx.letterSpacing = "0px";
  ctx.restore();
}

/** Name banner: a Current-tinted band with rules for legibility over art. */
function drawNamePlate(ctx: CanvasRenderingContext2D, card: CardDef, current: CurrentId): void {
  const palette = CURRENT_PALETTE[current];
  const r = LAYOUT.namePlate;

  ctx.save();
  ctx.beginPath();
  roundedRect(ctx, r, 9);
  const plate = ctx.createLinearGradient(r.x, 0, r.x + r.w, 0);
  plate.addColorStop(0, hexToRgba(mix(palette.lo, "#000000", 0.45), 0.9));
  plate.addColorStop(0.5, hexToRgba(mix(palette.key, "#000000", 0.5), 0.94));
  plate.addColorStop(1, hexToRgba(mix(palette.lo, "#000000", 0.45), 0.9));
  ctx.fillStyle = plate;
  ctx.fill();

  // bright hairline top and bottom, like an etched banner
  ctx.strokeStyle = hexToRgba(palette.hi, 0.55);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.95)";
  ctx.shadowBlur = 6;
  drawFittedLine(ctx, card.name, r.x + r.w / 2, r.y + r.h / 2 + 1, r.w - 30, 30, 15, "#ffffff");
  ctx.restore();

  // type line just beneath the banner
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = fontFor(13, true, false);
  ctx.shadowColor = "rgba(0,0,0,0.95)";
  ctx.shadowBlur = 5;
  ctx.fillStyle = hexToRgba(palette.hi, 0.92);
  ctx.letterSpacing = "2.5px";
  ctx.fillText(cardTypeLabel(card).toUpperCase(), CARD_W / 2, LAYOUT.typeLineY);
  ctx.letterSpacing = "0px";
  ctx.restore();
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

function drawTextBox(
  ctx: CanvasRenderingContext2D,
  card: CardDef,
  current: CurrentId,
  compactForBoard = false
): void {
  const palette = CURRENT_PALETTE[current];
  const r = compactForBoard ? LAYOUT.boardTextBox : LAYOUT.textBox;
  /**
   * §17's Rules Lens.
   *
   * Every keyword's reminder text, on the face, at every rarity — overriding the
   * templating rule that omits it on Epics and Legendaries on the grounds that
   * anybody playing those knows what the words mean. That grounds is a guess
   * about the reader, and this is the switch for the readers it guesses wrong
   * about.
   *
   * Only on the full card: the board's box is 84px tall and adding four lines of
   * italic to it would make the rules text unreadable for everybody, which is the
   * opposite of the point. `drawRichText` shrinks to fit and a test asserts every
   * shipped card still clears the minimum size with the lens on.
   */
  const body = [card.text?.trim() ?? "", compactForBoard ? "" : lensText(card)].filter(Boolean).join(" ");
  const hasBody = body.length > 0;

  // a solid-enough panel that rules text is readable over any artwork
  ctx.save();
  ctx.beginPath();
  roundedRect(ctx, r, 11);
  ctx.fillStyle = hexToRgba("#06040e", hasBody ? 0.86 : 0.6);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(palette.key, 0.42);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  const textArea = { x: r.x + 16, y: r.y + 12, w: r.w - 32, h: r.h - 24 };

  if (hasBody) {
    drawRichText(ctx, body, textArea, { maxSize: 20, minSize: 11, color: "#ece7ff" });
  } else if (card.flavor) {
    drawRichText(ctx, `*${card.flavor}*`, textArea, { maxSize: 18, minSize: 11, color: hexToRgba("#ece7ff", 0.66) });
  }
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

function drawStatChip(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  value: number,
  kind: "attack" | "health",
  buffed: boolean,
  damaged: boolean,
  emphasis = false
): void {
  const colors =
    kind === "attack"
      ? { a: "#ffd98a", b: "#e8891f", c: "#7a3a05" }
      : { a: "#ffb0b0", b: "#e03a4e", c: "#6d0f1c" };

  ctx.save();
  // A dark seat under the gem: at board size the gem's own glow is the thing
  // that makes it bleed into whatever artwork happens to sit behind it.
  if (emphasis) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.16, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fill();
  }
  ctx.shadowColor = hexToRgba(colors.b, 0.7);
  ctx.shadowBlur = 14;
  ctx.beginPath();
  if (kind === "attack") {
    // angular blade shape
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i - Math.PI / 2;
      const rad = i % 2 === 0 ? r : r * 0.82;
      const px = cx + Math.cos(a) * rad;
      const py = cy + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
  const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  grad.addColorStop(0, colors.a);
  grad.addColorStop(0.55, colors.b);
  grad.addColorStop(1, colors.c);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = hexToRgba("#ffffff", emphasis ? 0.72 : 0.55);
  ctx.lineWidth = emphasis ? 4 : 2;
  ctx.stroke();
  // a hard dark contour so the gem separates from the art at any size
  if (emphasis) {
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  const textColor = buffed ? "#7dff9a" : damaged ? "#ff9a9a" : "#ffffff";
  ctx.save();
  if (emphasis) {
    drawFittedLine(ctx, String(value), cx, cy + 2, r * 1.5, 96, 46, textColor, true, 9);
  } else {
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 4;
    drawFittedLine(ctx, String(value), cx, cy + 1, r * 1.6, 34, 18, textColor);
  }
  ctx.restore();
}

function drawRarityGem(ctx: CanvasRenderingContext2D, card: CardDef): void {
  const style = RARITY_STYLE[card.rarity];
  const { cx, cy, r } = LAYOUT.rarityGem;
  const spacing = r * 1.5;
  const total = (style.gems - 1) * spacing;

  for (let i = 0; i < style.gems; i++) {
    const x = cx - total / 2 + i * spacing;
    ctx.save();
    ctx.shadowColor = hexToRgba(style.color, 0.9);
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(x, cy - r * 0.62);
    ctx.lineTo(x + r * 0.52, cy);
    ctx.lineTo(x, cy + r * 0.62);
    ctx.lineTo(x - r * 0.52, cy);
    ctx.closePath();
    const grad = ctx.createLinearGradient(x - r, cy - r, x + r, cy + r);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.45, style.color);
    grad.addColorStop(1, mix(style.color, "#000000", 0.55));
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = hexToRgba("#ffffff", 0.6);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}

/** Animated foil for premium variants. */
function drawFoil(ctx: CanvasRenderingContext2D, current: CurrentId, phase: number): void {
  const palette = CURRENT_PALETTE[current];
  const rect = { x: LAYOUT.bleed, y: LAYOUT.bleed, w: CARD_W - LAYOUT.bleed * 2, h: CARD_H - LAYOUT.bleed * 2 };

  ctx.save();
  ctx.beginPath();
  traceFrame(ctx, palette.shape, rect);
  ctx.clip();
  ctx.globalCompositeOperation = "screen";

  const offset = (phase % 1) * (CARD_W + CARD_H);
  const sweep = ctx.createLinearGradient(offset - CARD_H, 0, offset, CARD_H);
  sweep.addColorStop(0, "rgba(0,0,0,0)");
  sweep.addColorStop(0.4, hexToRgba("#7df9ff", 0.16));
  sweep.addColorStop(0.5, hexToRgba("#ffffff", 0.26));
  sweep.addColorStop(0.6, hexToRgba("#ff8fd8", 0.16));
  sweep.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a card at its canonical 400x560 size into the given context.
 * The caller sets up scaling/DPR; this always draws in card-space.
 */
export function renderCard(
  ctx: CanvasRenderingContext2D,
  card: CardDef,
  options: RenderCardOptions = {}
): void {
  const current: CurrentId = card.current;

  ctx.clearRect(0, 0, CARD_W, CARD_H);
  ctx.save();
  if (options.dimmed) ctx.globalAlpha = 0.45;

  drawArt(ctx, card, current, options.art ?? null);
  drawFrameRim(ctx, current);
  drawNamePlate(ctx, card, current);
  drawTextBox(ctx, card, current, options.statEmphasis === true);
  // leaders are never played from hand, so they carry no Hype cost gem
  if (card.type !== "leader") drawCostGem(ctx, card.cost, current);
  drawCurrentBadge(ctx, current);
  drawFactionCrest(
    ctx,
    FACTION_INDEX[card.faction] ?? 10,
    LAYOUT.crest.cx,
    LAYOUT.crest.cy,
    LAYOUT.crest.r,
    hexToRgba(FACTION_COLOR[card.faction] ?? "#8f8aa8", 0.92),
    card.faction
  );
  drawRarityGem(ctx, card);

  // stat chips — board cards read theirs at ~121px wide, so they enlarge
  const big = options.statEmphasis === true;
  const atkChip = big ? LAYOUT.boardAttackChip : LAYOUT.attackChip;
  const hpChip = big ? LAYOUT.boardHealthChip : LAYOUT.healthChip;
  if (card.type === "character" || card.type === "leader") {
    const def = card as CharacterCardDef | LeaderCardDef;
    const baseAttack = "attack" in def ? def.attack : 0;
    const baseHealth = "health" in def ? def.health : 0;
    const attack = options.liveAttack ?? baseAttack;
    const health = options.liveHealth ?? baseHealth;
    if (card.type === "character") {
      drawStatChip(ctx, atkChip.cx, atkChip.cy, atkChip.r, attack, "attack", attack > baseAttack, false, big);
      const maxHealth = options.liveMaxHealth ?? baseHealth;
      drawStatChip(ctx, hpChip.cx, hpChip.cy, hpChip.r, health, "health", maxHealth > baseHealth, health < maxHealth, big);
    } else {
      drawStatChip(ctx, hpChip.cx, hpChip.cy, hpChip.r, health, "health", false, false, big);
    }
  } else if (card.type === "equipment") {
    const equip = card as EquipmentCardDef;
    if (equip.equipAttack) drawStatChip(ctx, atkChip.cx, atkChip.cy, atkChip.r, equip.equipAttack, "attack", false, false, big);
    if (equip.equipHealth) drawStatChip(ctx, hpChip.cx, hpChip.cy, hpChip.r, equip.equipHealth, "health", false, false, big);
  } else if (card.type === "location") {
    const location = card as LocationCardDef;
    if (location.durability) {
      drawStatChip(ctx, hpChip.cx, hpChip.cy, hpChip.r, location.durability, "health", false, false, big);
    }
  }

  if (options.premium) drawFoil(ctx, current, options.phase ?? 0);

  // interaction rings
  if (options.highlight && options.highlight !== "none") {
    const ringColor =
      options.highlight === "playable" ? "#7dffb0" : options.highlight === "target" ? "#ff5f7a" : "#ffd86b";
    const rect = { x: LAYOUT.bleed - 3, y: LAYOUT.bleed - 3, w: CARD_W - LAYOUT.bleed * 2 + 6, h: CARD_H - LAYOUT.bleed * 2 + 6 };
    ctx.save();
    ctx.shadowColor = ringColor;
    ctx.shadowBlur = 22;
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    traceFrame(ctx, CURRENT_PALETTE[current].shape, rect);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

/**
 * Render a card into a fresh canvas at the requested pixel width.
 *
 * Art loads asynchronously, so the first paint uses the placeholder. The canvas
 * subscribes to the art loader and repaints itself once the real image arrives
 * — that is what makes "drop a PNG in public/assets/art" work with no reload.
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

  const paint = (): void => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(scale * dpr, scale * dpr);
    renderCard(ctx, card, { ...options, art: options.art ?? getCardArt(card) });
  };
  paint();

  const unsubscribe = onArtLoaded((cardId) => {
    if (cardId !== card.id) return;
    paint();
    unsubscribe();
  });

  /**
   * The same treatment for the Current and crest icons.
   *
   * They are preloaded at boot, so this almost never fires — but "almost" is
   * doing real work on a first visit, where a card can be drawn in the
   * milliseconds before nineteen small PNGs finish decoding. Without it those
   * cards keep the procedural shapes until something else forces a repaint,
   * which on the collection screen may be never.
   *
   * One shot, then it lets go. A screen can hold hundreds of card canvases and
   * each listener that outlived its canvas would be a leak.
   */
  const unsubscribeIcons = onAssetLoaded(() => {
    paint();
    unsubscribeIcons();
  });

  return canvas;
}

export { CARD_W, CARD_H };
