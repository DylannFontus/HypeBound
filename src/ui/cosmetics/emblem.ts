/**
 * The emblems cosmetics are drawn with.
 *
 * Card backs and profile frames both need a faction's mark, and both are drawn
 * to a 2D canvas — one as a three.js texture, one as an avatar ring — so the
 * shapes live here rather than in either. Procedural, like every other visual in
 * this game: the whole cosmetics layer costs zero art assets, and a new faction
 * gets a card back the moment it gets a colour.
 *
 * `drawEmblem` is deliberately total. Every id in `EMBLEMS` has a case, and the
 * default draws the house diamond rather than nothing — because the failure mode
 * of a missing case is a card back that resolves, validates, is granted, is
 * equipped, and renders blank. `tests/cosmetics.test.ts` walks every emblem and
 * asserts each one puts different pixels on the canvas.
 */

import type { EmblemId } from "../../game/cosmetics/data";

export type EmblemShape = EmblemId | "diamond";

export interface CardBackStyle {
  color: string;
  emblem: EmblemShape;
}

/** `#rrggbb` to a triple. Falls back to the house purple on anything unparsable. */
export function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return [181, 108, 255];
  const value = Number.parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const ring = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void => {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
};

const polygon = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  sides: number,
  rotation = 0
): void => {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i / sides) * Math.PI * 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
};

/**
 * Draw one emblem centred on (cx, cy).
 *
 * `stroke` and `fill` are taken from the context, so a caller sets the colour
 * once. `scale` is 1 for a card back; the frame passes something smaller.
 */
export function drawEmblem(
  ctx: CanvasRenderingContext2D,
  emblem: EmblemShape,
  cx: number,
  cy: number,
  scale = 1
): void {
  const s = (value: number): number => value * scale;
  ctx.save();

  switch (emblem) {
    case "starburst": {
      // Neon Idols — stage lights from a single point
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const inner = s(i % 2 === 0 ? 16 : 24);
        const outer = s(i % 2 === 0 ? 96 : 62);
        ctx.globalAlpha = i % 2 === 0 ? 0.75 : 0.4;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
        ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.8;
      ring(ctx, cx, cy, s(14));
      break;
    }
    case "rose": {
      // Gothic Royalty — layered petals, a wreath for a dead fandom
      for (let layer = 0; layer < 4; layer++) {
        const r = s(24 + layer * 18);
        ctx.globalAlpha = 0.7 - layer * 0.13;
        for (let i = 0; i < 6; i++) {
          const angle = (i / 6) * Math.PI * 2 + layer * 0.5;
          ctx.beginPath();
          ctx.ellipse(cx + Math.cos(angle) * r * 0.5, cy + Math.sin(angle) * r * 0.5, r * 0.5, r * 0.28, angle, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      break;
    }
    case "spiral": {
      // Viral Influencers — one idea, going round faster
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      for (let t = 0; t < Math.PI * 8; t += 0.08) {
        const r = s(6 + t * 4.4);
        const x = cx + Math.cos(t) * r;
        const y = cy + Math.sin(t) * r;
        if (t === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      break;
    }
    case "grid": {
      // Corporate Creators — an org chart with nobody's name on it
      ctx.globalAlpha = 0.55;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + s(i * 22), cy - s(84));
        ctx.lineTo(cx + s(i * 22), cy + s(84));
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - s(84), cy + s(i * 22));
        ctx.lineTo(cx + s(84), cy + s(i * 22));
        ctx.stroke();
      }
      ctx.globalAlpha = 0.9;
      ctx.strokeRect(cx - s(24), cy - s(24), s(48), s(48));
      break;
    }
    case "sigil": {
      // Digital Demons — a summoning circle drawn in a dialog box
      ctx.globalAlpha = 0.7;
      ring(ctx, cx, cy, s(88));
      ring(ctx, cx, cy, s(76));
      polygon(ctx, cx, cy, s(70), 5, -Math.PI / 2);
      polygon(ctx, cx, cy, s(70), 5, -Math.PI / 2 + Math.PI / 5);
      ctx.globalAlpha = 0.5;
      ring(ctx, cx, cy, s(20));
      break;
    }
    case "visor": {
      // Cosplay Champions — a helm, seen head on
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.moveTo(cx - s(76), cy - s(24));
      ctx.quadraticCurveTo(cx, cy - s(92), cx + s(76), cy - s(24));
      ctx.lineTo(cx + s(52), cy + s(64));
      ctx.lineTo(cx - s(52), cy + s(64));
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 0.5;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + s(i * 26), cy - s(10));
        ctx.lineTo(cx + s(i * 26), cy + s(50));
        ctx.stroke();
      }
      break;
    }
    case "glass": {
      // Afterparty Crew — the last one, at the wrong angle
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.moveTo(cx - s(58), cy - s(64));
      ctx.lineTo(cx + s(58), cy - s(64));
      ctx.lineTo(cx + s(8), cy + s(6));
      ctx.lineTo(cx + s(8), cy + s(66));
      ctx.lineTo(cx + s(40), cy + s(78));
      ctx.lineTo(cx - s(40), cy + s(78));
      ctx.lineTo(cx - s(8), cy + s(66));
      ctx.lineTo(cx - s(8), cy + s(6));
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.fill();
      break;
    }
    case "leaf": {
      // Touch-Grass Order — outside, allegedly
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.moveTo(cx, cy - s(88));
      ctx.quadraticCurveTo(cx + s(72), cy - s(10), cx, cy + s(88));
      ctx.quadraticCurveTo(cx - s(72), cy - s(10), cx, cy - s(88));
      ctx.stroke();
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.moveTo(cx, cy - s(76));
      ctx.lineTo(cx, cy + s(76));
      ctx.stroke();
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(cx, cy + s(i * 24));
        ctx.lineTo(cx + s(34), cy + s(i * 24 + 20));
        ctx.moveTo(cx, cy + s(i * 24));
        ctx.lineTo(cx - s(34), cy + s(i * 24 + 20));
        ctx.stroke();
      }
      break;
    }
    case "eye": {
      // Algorithm Syndicate — the row that knows
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.moveTo(cx - s(92), cy);
      ctx.quadraticCurveTo(cx, cy - s(66), cx + s(92), cy);
      ctx.quadraticCurveTo(cx, cy + s(66), cx - s(92), cy);
      ctx.stroke();
      ring(ctx, cx, cy, s(30));
      ctx.globalAlpha = 0.5;
      ring(ctx, cx, cy, s(12));
      break;
    }
    case "stamp": {
      // Meme Collective — minuted, seconded, carried
      ctx.globalAlpha = 0.7;
      polygon(ctx, cx, cy, s(88), 8, Math.PI / 8);
      polygon(ctx, cx, cy, s(66), 8, Math.PI / 8);
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(cx - s(38), cy);
      ctx.lineTo(cx - s(10), cy + s(30));
      ctx.lineTo(cx + s(40), cy - s(28));
      ctx.stroke();
      break;
    }
    case "laurel": {
      // 250 achievement points — the wreath, worn slightly ironically
      ctx.globalAlpha = 0.75;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + side * s(10), cy + s(78));
        ctx.quadraticCurveTo(cx + side * s(92), cy + s(10), cx + side * s(22), cy - s(78));
        ctx.stroke();
        for (let i = 0; i < 6; i++) {
          const t = 0.12 + i * 0.15;
          const x = cx + side * s(10 + t * 120 * (1 - t) * 1.6);
          const y = cy + s(78 - t * 156);
          ctx.beginPath();
          ctx.ellipse(x, y, s(20), s(9), side * (0.9 - t), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      break;
    }
    case "trophy": {
      // 500 achievement points — a whole wall of them, starting with one
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.moveTo(cx - s(46), cy - s(70));
      ctx.lineTo(cx + s(46), cy - s(70));
      ctx.lineTo(cx + s(30), cy + s(6));
      ctx.lineTo(cx - s(30), cy + s(6));
      ctx.closePath();
      ctx.stroke();
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + side * s(46), cy - s(58));
        ctx.quadraticCurveTo(cx + side * s(88), cy - s(30), cx + side * s(34), cy - s(6));
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx, cy + s(6));
      ctx.lineTo(cx, cy + s(48));
      ctx.stroke();
      ctx.strokeRect(cx - s(42), cy + s(48), s(84), s(20));
      break;
    }
    case "hoard": {
      // The Hoard — three hundred cards, stacked and gloated over
      ctx.globalAlpha = 0.7;
      for (let row = 0; row < 4; row++) {
        const count = 4 - row;
        for (let i = 0; i < count; i++) {
          const w = s(38);
          const h = s(22);
          const x = cx - (count * w) / 2 + i * w;
          const y = cy + s(56) - row * h;
          ctx.strokeRect(x, y, w * 0.92, h * 0.92);
        }
      }
      ctx.globalAlpha = 0.45;
      ring(ctx, cx, cy - s(52), s(18));
      break;
    }
    case "signal": {
      // Season 1, First Upload — a broadcast leaving somebody's bedroom
      ctx.globalAlpha = 0.75;
      for (let i = 1; i <= 4; i++) {
        const r = s(i * 22);
        ctx.beginPath();
        ctx.arc(cx, cy + s(46), r, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(cx - s(30), cy + s(78));
      ctx.lineTo(cx, cy + s(30));
      ctx.lineTo(cx + s(30), cy + s(78));
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 0.4;
      ring(ctx, cx, cy + s(46), s(8));
      break;
    }
    case "mask": {
      // Season 2, Second Account — the same face, differently labelled
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.moveTo(cx - s(88), cy - s(30));
      ctx.quadraticCurveTo(cx, cy - s(72), cx + s(88), cy - s(30));
      ctx.quadraticCurveTo(cx + s(60), cy + s(64), cx, cy + s(78));
      ctx.quadraticCurveTo(cx - s(60), cy + s(64), cx - s(88), cy - s(30));
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 0.5;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(cx + side * s(36), cy - s(6), s(20), s(12), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(cx - s(18), cy + s(40));
      ctx.quadraticCurveTo(cx, cy + s(52), cx + s(18), cy + s(40));
      ctx.stroke();
      break;
    }
    case "sunrise": {
      // "Day One" — a first upload going out over the horizon
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(cx, cy + s(18), s(46), Math.PI, 0);
      ctx.stroke();
      ctx.globalAlpha = 0.55;
      for (let ray = 0; ray < 9; ray++) {
        const angle = Math.PI + (ray / 8) * Math.PI;
        const inner = s(56);
        const outer = s(ray % 2 === 0 ? 104 : 82);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * inner, cy + s(18) + Math.sin(angle) * inner);
        ctx.lineTo(cx + Math.cos(angle) * outer, cy + s(18) + Math.sin(angle) * outer);
        ctx.stroke();
      }
      // the horizon it is coming up over
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(cx - s(112), cy + s(18));
      ctx.lineTo(cx + s(112), cy + s(18));
      ctx.stroke();
      break;
    }
    case "bracket": {
      // The Gauntlet — a draft bracket narrowing to one, twelve seats to a final
      ctx.globalAlpha = 0.68;
      for (let round = 0; round < 3; round++) {
        const x = s(-84 + round * 46);
        const spacing = s(56) / Math.pow(2, round);
        const seats = 4 / Math.pow(2, round);
        for (let seat = 0; seat < seats; seat++) {
          const y = cy + (seat - (seats - 1) / 2) * spacing * 2;
          ctx.beginPath();
          ctx.moveTo(cx + x, y - spacing * 0.5);
          ctx.lineTo(cx + x + s(30), y - spacing * 0.5);
          ctx.lineTo(cx + x + s(30), y + spacing * 0.5);
          ctx.lineTo(cx + x, y + spacing * 0.5);
          ctx.stroke();
        }
        ctx.globalAlpha -= 0.12;
      }
      // the seat nobody shares
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(cx + s(68), cy);
      ctx.lineTo(cx + s(96), cy);
      ctx.stroke();
      polygon(ctx, cx + s(112), cy, s(16), 3, -Math.PI / 2);
      break;
    }
    default: {
      // the house diamond, and the fallback for anything unrecognised
      for (let i = 0; i < 5; i++) {
        const r = s(26 + i * 20);
        ctx.globalAlpha = 0.7 - i * 0.12;
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r * 0.72, cy);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r * 0.72, cy);
        ctx.closePath();
        ctx.stroke();
      }
      break;
    }
  }

  ctx.restore();
}
