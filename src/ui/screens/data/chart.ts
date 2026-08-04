/**
 * The two charts the Statistics screen never had.
 *
 * Recon defect 6: *"the screen called Statistics contains no chart"* — no axis,
 * no line, no time series, six numbers and three lists of 90px bars. And the
 * one thing that looked like a visualisation, the 30-match trend strip, was
 * thirty identical 10×18px rectangles distinguished **by background colour
 * alone**, which is not a style complaint: it is a hard-constraint breach. A
 * deuteranope reads thirty grey blocks.
 *
 * Two drawings live here, both canvas 2D, no dependency:
 *
 *  - **`sparkline`** — the trend strip made honest. A win is a full bar above
 *    the baseline, a draw is a half bar sitting on it, a loss is a bar hanging
 *    *below* it. Shape carries the signal and colour reinforces it, which is the
 *    order §9 requires. The baseline is a real hairline so "below" means
 *    something.
 *  - **`winRateCurve`** — the cumulative win rate over the last N matches, with
 *    a labelled 40/50/60% grid, a 50% reference line and a **confidence band**
 *    that is wide at three matches and narrow at a hundred. A dashboard that
 *    prints 56% over nine matches the same way it prints 56% over three hundred
 *    is a dashboard that talks people into rebuilding decks for no reason; the
 *    band is that sentence, drawn.
 *
 * ## Drawn at device resolution, laid out in CSS pixels
 *
 * Both take a CSS size and multiply by `devicePixelRatio` internally, because a
 * chart is the one place in a UI where a half-pixel line is the whole point and
 * a 1× canvas on a 2× display turns a hairline into a grey smear.
 *
 * ## Why not SVG
 *
 * Sixty points of line, a band, a grid and thirty bars is sixty DOM nodes per
 * chart on a screen that re-renders on every filter click. The canvas is one
 * node and one paint.
 */

import { LIGHT_RIG } from "../../art/texture";

export type TrendResult = "win" | "loss" | "draw";

const DPR = (): number => Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));

function surface(cssW: number, cssH: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement("canvas");
  const ratio = DPR();
  canvas.width = Math.max(1, Math.round(cssW * ratio));
  canvas.height = Math.max(1, Math.round(cssH * ratio));
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(ratio, ratio);
  return { canvas, ctx };
}

export interface SparklineOptions {
  width?: number;
  height?: number;
  win?: string;
  loss?: string;
  draw?: string;
}

/**
 * The last N results as a shape, not as a colour code.
 *
 * Bars are drawn oldest-first, left to right, which matches the tooltip the
 * caller writes and matches how every other timeline in the game runs.
 */
export function sparkline(results: readonly TrendResult[], options: SparklineOptions = {}): HTMLCanvasElement | null {
  const width = options.width ?? 320;
  const height = options.height ?? 44;
  const target = surface(width, height);
  if (!target) return null;
  const { canvas, ctx } = target;

  const win = options.win ?? "#7ee7a8";
  const loss = options.loss ?? "#ff6078";
  const draw = options.draw ?? "#a49cc2";

  const mid = Math.round(height * 0.58) + 0.5;

  // the baseline, faded at both ends the way §7 asks every divider to be
  const rule = ctx.createLinearGradient(0, 0, width, 0);
  rule.addColorStop(0, "rgba(255,255,255,0)");
  rule.addColorStop(0.12, "rgba(255,255,255,0.22)");
  rule.addColorStop(0.88, "rgba(255,255,255,0.22)");
  rule.addColorStop(1, "rgba(255,255,255,0)");
  ctx.strokeStyle = rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(width, mid);
  ctx.stroke();

  if (results.length === 0) return canvas;

  const gap = 2;
  const slot = width / results.length;
  const barW = Math.max(2, Math.min(11, slot - gap));

  results.forEach((result, i) => {
    const x = i * slot + (slot - barW) / 2;
    const colour = result === "win" ? win : result === "loss" ? loss : draw;
    // win: a full bar standing on the line. draw: a half bar. loss: hanging below.
    const up = result !== "loss";
    const magnitude = result === "win" ? 1 : result === "draw" ? 0.42 : 0.62;
    const span = (up ? height * 0.5 : height * 0.36) * magnitude;
    const y = up ? mid - span : mid;

    const ramp = ctx.createLinearGradient(x, up ? y : mid + span, x + barW, up ? mid : mid);
    ramp.addColorStop(0, colour);
    ramp.addColorStop(1, `${colour}77`);
    ctx.fillStyle = ramp;
    ctx.fillRect(x, y, barW, Math.max(2, span));

    // a bright cap on the far end, so the bar has a lit edge like every plate
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect(x, up ? y : mid + span - 1.5, barW, 1.5);
  });

  return canvas;
}

export interface CurveOptions {
  width?: number;
  height?: number;
  accent?: string;
  /** Draw the sample-confidence band. Off for very short series. */
  band?: boolean;
}

/**
 * Cumulative win rate over the series, with a confidence band.
 *
 * The band is a Wald interval at 95% — `1.96 · sqrt(p(1-p)/n)` — clamped to the
 * plot. It is not a claim about the population; it is a picture of how little a
 * five-match sample knows about itself, and it collapses toward the line as the
 * series grows, which is exactly the intuition the screen is trying to hand over.
 */
export function winRateCurve(
  results: readonly TrendResult[],
  options: CurveOptions = {}
): HTMLCanvasElement | null {
  const width = options.width ?? 640;
  const height = options.height ?? 190;
  const accent = options.accent ?? "#c07dff";
  const target = surface(width, height);
  if (!target) return null;
  const { canvas, ctx } = target;

  const padL = 40;
  const padR = 12;
  const padT = 12;
  const padB = 22;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const yFor = (rate: number): number => padT + plotH * (1 - rate);

  // the well the chart sits in: recessed, lit from the bottom-right like
  // `.mat-well`, so the plot is a groove in the panel rather than a sticker
  const [gx0, gy0, gx1, gy1] = (() => {
    const radians = ((LIGHT_RIG.cssAngle - 90) * Math.PI) / 180;
    const half = Math.hypot(width, height) / 2;
    return [
      width / 2 + Math.cos(radians) * half,
      height / 2 + Math.sin(radians) * half,
      width / 2 - Math.cos(radians) * half,
      height / 2 - Math.sin(radians) * half,
    ] as const;
  })();
  const floor = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
  floor.addColorStop(0, "rgba(2,1,6,0.62)");
  floor.addColorStop(1, "rgba(22,15,42,0.42)");
  ctx.fillStyle = floor;
  ctx.fillRect(padL, padT, plotW, plotH);

  // grid at 25/50/75, labelled where it matters
  ctx.font = "500 10px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const rate of [0.25, 0.5, 0.75]) {
    const y = Math.round(yFor(rate)) + 0.5;
    ctx.strokeStyle = rate === 0.5 ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.075)";
    ctx.lineWidth = 1;
    ctx.setLineDash(rate === 0.5 ? [] : [3, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = rate === 0.5 ? "rgba(230,226,244,0.78)" : "rgba(164,156,194,0.72)";
    ctx.fillText(`${Math.round(rate * 100)}%`, padL - 7, y);
  }

  if (results.length === 0) return canvas;

  // cumulative rate, oldest first
  const points: { x: number; rate: number; n: number }[] = [];
  let won = 0;
  let counted = 0;
  results.forEach((result, i) => {
    counted += 1;
    if (result === "win") won += 1;
    const x = padL + (results.length === 1 ? plotW / 2 : (i / (results.length - 1)) * plotW);
    points.push({ x, rate: won / counted, n: counted });
  });

  if (options.band !== false) {
    ctx.beginPath();
    points.forEach((point, i) => {
      const halfWidth = 1.96 * Math.sqrt(Math.max(0.02, point.rate * (1 - point.rate)) / point.n);
      const y = yFor(Math.min(1, point.rate + halfWidth));
      if (i === 0) ctx.moveTo(point.x, y);
      else ctx.lineTo(point.x, y);
    });
    for (let i = points.length - 1; i >= 0; i--) {
      const point = points[i]!;
      const halfWidth = 1.96 * Math.sqrt(Math.max(0.02, point.rate * (1 - point.rate)) / point.n);
      ctx.lineTo(point.x, yFor(Math.max(0, point.rate - halfWidth)));
    }
    ctx.closePath();
    const wash = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    wash.addColorStop(0, `${accent}2e`);
    wash.addColorStop(1, `${accent}12`);
    ctx.fillStyle = wash;
    ctx.fill();
  }

  // the line, with its own soft glow — the brightest thing in the plot,
  // because it is the thing the panel is about
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.2;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  points.forEach((point, i) => {
    const y = yFor(point.rate);
    if (i === 0) ctx.moveTo(point.x, y);
    else ctx.lineTo(point.x, y);
  });
  ctx.stroke();
  ctx.shadowBlur = 0;

  // the head of the line is where the player actually is
  const last = points[points.length - 1]!;
  const y = yFor(last.rate);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(last.x - 1, y, 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.stroke();

  // sample count, bottom-left, so the axis says what it is counting
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(164,156,194,0.85)";
  ctx.fillText(`${results.length} matches, oldest first`, padL + 2, height - 10);
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(last.rate * 100)}% overall`, padL + plotW, height - 10);

  return canvas;
}
