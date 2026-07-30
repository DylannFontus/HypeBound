/**
 * Hatch fills for the Current badge — `13-accessibility.md` §8.1.
 *
 * The fourth redundant channel. A Current already carries a frame shape, a glyph
 * and a printed label; the hatch is the one that survives a photograph, a stream
 * compressed to mush, a monitor with its saturation at zero, and being seen out
 * of the corner of an eye.
 *
 * Eight patterns for eight Currents, each chosen to read at badge size (190×52)
 * and to stay distinct from the others in silhouette rather than in density —
 * two patterns that differ only in how much ink they use look identical the
 * moment the card is scaled down to board size.
 */

import type { HatchPattern } from "./palette";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Whether hatches are being drawn.
 *
 * A module-level flag rather than a parameter threaded through nine private
 * drawing functions: the renderer is called from a dozen places that have no
 * business knowing about accessibility settings, and `applySettings` is already
 * the one funnel that decides.
 */
let patterns = false;

export const setPatterns = (on: boolean): void => {
  patterns = on;
};

export const patternsOn = (): boolean => patterns;

/** Draw one pattern across a rectangle. The caller clips and sets the alpha. */
export function drawHatch(ctx: CanvasRenderingContext2D, pattern: HatchPattern, rect: Rect, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  const { x, y, w, h } = rect;
  const step = 10;

  switch (pattern) {
    case "diagonal":
      for (let i = -h; i < w + h; i += step) {
        ctx.beginPath();
        ctx.moveTo(x + i, y + h);
        ctx.lineTo(x + i + h, y);
        ctx.stroke();
      }
      break;

    case "wave":
      for (let row = y + 4; row < y + h; row += step) {
        ctx.beginPath();
        ctx.moveTo(x, row);
        for (let i = 0; i < w; i += step) {
          ctx.quadraticCurveTo(x + i + step / 4, row - 4, x + i + step / 2, row);
          ctx.quadraticCurveTo(x + i + (step * 3) / 4, row + 4, x + i + step, row);
        }
        ctx.stroke();
      }
      break;

    case "grid":
      for (let i = 0; i < w; i += step) {
        ctx.beginPath();
        ctx.moveTo(x + i, y);
        ctx.lineTo(x + i, y + h);
        ctx.stroke();
      }
      for (let row = 0; row < h; row += step) {
        ctx.beginPath();
        ctx.moveTo(x, y + row);
        ctx.lineTo(x + w, y + row);
        ctx.stroke();
      }
      break;

    case "chevron":
      for (let i = -h; i < w + h; i += step * 2) {
        ctx.beginPath();
        ctx.moveTo(x + i, y + h);
        ctx.lineTo(x + i + h / 2, y);
        ctx.lineTo(x + i + h, y + h);
        ctx.stroke();
      }
      break;

    case "dots":
      for (let row = y + 6; row < y + h; row += step) {
        for (let col = x + 6; col < x + w; col += step) {
          ctx.beginPath();
          ctx.arc(col, row, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;

    case "rays": {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const reach = Math.hypot(w, h);
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 10) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach);
        ctx.stroke();
      }
      break;
    }

    case "cross":
      for (let i = -h; i < w + h; i += step) {
        ctx.beginPath();
        ctx.moveTo(x + i, y + h);
        ctx.lineTo(x + i + h, y);
        ctx.moveTo(x + i, y);
        ctx.lineTo(x + i + h, y + h);
        ctx.stroke();
      }
      break;

    case "checker":
      for (let row = 0; row * step < h; row++) {
        for (let col = 0; col * step < w; col++) {
          if ((row + col) % 2 !== 0) continue;
          ctx.fillRect(x + col * step, y + row * step, step, step);
        }
      }
      break;
  }

  ctx.restore();
}
