/**
 * Procedural placeholder art.
 *
 * Until the owner drops a real image at public/assets/art/<card-id>.png, every
 * card still needs to look finished. This generates a deterministic, Current-
 * themed abstract composition from the card's name, so each card is visually
 * distinct and the game never shows a broken-image box.
 */

import type { CurrentId } from "../../engine/types";
import { CURRENT_PALETTE, hexToRgba, mix } from "./palette";
import type { Rect } from "./frameShapes";

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

/**
 * Draw the placeholder into `rect`. The composition is a lit backdrop, a
 * silhouetted figure suggesting a character, and Current-specific motion
 * elements — enough structure that the card reads as designed, not empty.
 */
export function drawPlaceholderArt(ctx: CanvasRenderingContext2D, rect: Rect, current: CurrentId, name: string): void {
  const palette = CURRENT_PALETTE[current];
  const rand = makeRandom(hashString(name + current));

  // --- backdrop: a stage wash in the Current's colours ---------------------
  const sky = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
  sky.addColorStop(0, mix(palette.lo, palette.key, 0.35));
  sky.addColorStop(0.55, palette.lo);
  sky.addColorStop(1, palette.abyss);
  ctx.fillStyle = sky;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  // --- distant skyline / stage rigging -------------------------------------
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = palette.abyss;
  const towers = 7 + Math.floor(rand() * 5);
  for (let i = 0; i < towers; i++) {
    const w = rect.w / towers;
    const x = rect.x + i * w;
    const h = rect.h * (0.16 + rand() * 0.32);
    ctx.fillRect(x, rect.y + rect.h - h, w * 0.86, h);
  }
  ctx.restore();

  // --- spotlight cones from the top ----------------------------------------
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 3; i++) {
    const originX = rect.x + rect.w * (0.2 + i * 0.3);
    const spread = rect.w * (0.1 + rand() * 0.1);
    const cone = ctx.createLinearGradient(originX, rect.y, originX, rect.y + rect.h);
    cone.addColorStop(0, hexToRgba(palette.hi, 0.3));
    cone.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(originX - 6, rect.y);
    ctx.lineTo(originX + 6, rect.y);
    ctx.lineTo(originX + spread, rect.y + rect.h);
    ctx.lineTo(originX - spread, rect.y + rect.h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // --- central figure silhouette -------------------------------------------
  const cx = rect.x + rect.w / 2;
  const baseY = rect.y + rect.h * 0.96;
  const figureH = rect.h * 0.62;
  const headR = figureH * 0.13;

  ctx.save();
  // rim light behind the figure
  const halo = ctx.createRadialGradient(cx, baseY - figureH * 0.55, 4, cx, baseY - figureH * 0.55, figureH * 0.7);
  halo.addColorStop(0, hexToRgba(palette.key, 0.55));
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  ctx.fillStyle = hexToRgba("#05030b", 0.9);
  // torso
  ctx.beginPath();
  ctx.moveTo(cx - figureH * 0.19, baseY);
  ctx.quadraticCurveTo(cx - figureH * 0.15, baseY - figureH * 0.5, cx - figureH * 0.13, baseY - figureH * 0.62);
  ctx.lineTo(cx + figureH * 0.13, baseY - figureH * 0.62);
  ctx.quadraticCurveTo(cx + figureH * 0.15, baseY - figureH * 0.5, cx + figureH * 0.19, baseY);
  ctx.closePath();
  ctx.fill();
  // head
  ctx.beginPath();
  ctx.arc(cx, baseY - figureH * 0.62 - headR * 0.85, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // --- Current-specific motion elements ------------------------------------
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.strokeStyle = hexToRgba(palette.hi, 0.5);
  ctx.fillStyle = hexToRgba(palette.hi, 0.5);
  ctx.lineWidth = 2;

  switch (current) {
    case "cinder": // rising embers
      for (let i = 0; i < 26; i++) {
        const x = rect.x + rand() * rect.w;
        const y = rect.y + rect.h - rand() * rect.h * 0.85;
        const r = 1 + rand() * 2.6;
        ctx.globalAlpha = 0.25 + rand() * 0.5;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case "tide": // horizontal wave bands
      for (let i = 0; i < 5; i++) {
        const y = rect.y + rect.h * (0.45 + i * 0.11);
        ctx.globalAlpha = 0.16 + rand() * 0.2;
        ctx.beginPath();
        ctx.moveTo(rect.x, y);
        for (let x = 0; x <= rect.w; x += 16) {
          ctx.lineTo(rect.x + x, y + Math.sin(x / 26 + i) * 5);
        }
        ctx.stroke();
      }
      break;
    case "root": // growing stems
      for (let i = 0; i < 9; i++) {
        const x = rect.x + rand() * rect.w;
        const h = rect.h * (0.15 + rand() * 0.3);
        ctx.globalAlpha = 0.2 + rand() * 0.3;
        ctx.beginPath();
        ctx.moveTo(x, rect.y + rect.h);
        ctx.quadraticCurveTo(x + (rand() - 0.5) * 30, rect.y + rect.h - h * 0.6, x + (rand() - 0.5) * 20, rect.y + rect.h - h);
        ctx.stroke();
      }
      break;
    case "gale": // speed lines
      for (let i = 0; i < 16; i++) {
        const y = rect.y + rand() * rect.h;
        const len = rect.w * (0.2 + rand() * 0.5);
        const x = rect.x + rand() * (rect.w - len);
        ctx.globalAlpha = 0.14 + rand() * 0.28;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + len, y - 5);
        ctx.stroke();
      }
      break;
    case "pulse": // circuit traces
      for (let i = 0; i < 12; i++) {
        let x = rect.x + rand() * rect.w;
        let y = rect.y + rand() * rect.h;
        ctx.globalAlpha = 0.18 + rand() * 0.3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let s = 0; s < 3; s++) {
          if (rand() > 0.5) x += (rand() - 0.5) * 60;
          else y += (rand() - 0.5) * 50;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
    case "halo": // radiant rays from the figure
      for (let i = 0; i < 14; i++) {
        const a = (Math.PI * 2 * i) / 14;
        const inner = figureH * 0.4;
        const outer = inner + rect.h * (0.1 + rand() * 0.2);
        ctx.globalAlpha = 0.1 + rand() * 0.2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * inner, baseY - figureH * 0.55 + Math.sin(a) * inner);
        ctx.lineTo(cx + Math.cos(a) * outer, baseY - figureH * 0.55 + Math.sin(a) * outer);
        ctx.stroke();
      }
      break;
    case "veil": // fracture cracks
      for (let i = 0; i < 8; i++) {
        let x = rect.x + rand() * rect.w;
        let y = rect.y + rand() * rect.h;
        ctx.globalAlpha = 0.2 + rand() * 0.35;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let s = 0; s < 4; s++) {
          x += (rand() - 0.5) * 50;
          y += (rand() - 0.5) * 50;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
    case "prism": // refracted light bands
      for (let i = 0; i < 7; i++) {
        const hue = (i / 7) * 360;
        ctx.globalAlpha = 0.16;
        ctx.strokeStyle = `hsl(${hue}, 90%, 68%)`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(cx, rect.y + rect.h * 0.3);
        ctx.lineTo(rect.x + rect.w * (i / 6), rect.y + rect.h);
        ctx.stroke();
      }
      break;
  }
  ctx.restore();

  // --- "art pending" watermark, quiet enough not to look broken ------------
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = palette.hi;
  ctx.letterSpacing = "1.5px";
  ctx.fillText("ART PENDING", rect.x + rect.w - 8, rect.y + rect.h - 6);
  ctx.letterSpacing = "0px";
  ctx.restore();
}
