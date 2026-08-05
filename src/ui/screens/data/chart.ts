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
 * The band is a Wald interval — `z · sqrt(p(1-p)/n)` — and it is *not* a claim
 * about the population; it is a picture of how little a five-match sample knows
 * about itself, collapsing toward the line as the series grows.
 *
 * ## Three things it used to get wrong, all of them about edges
 *
 * **The band was unclamped.** At three matches the 95% half-width is wider than
 * the whole scale, so the upper bound left the plot and came back as a *hard
 * horizontal edge* running the width of the panel, and the lower bound left the
 * bottom and cut a black wedge out of the corner. Measured on the seeded
 * account, the top edge was a straight line from x=110 to x=350. A confidence
 * band whose own shape is a rectangle is telling the reader the opposite of what
 * it means. Both bounds are clamped to [0,1] *and* the path is clipped to the
 * plot rect, so nothing ever meets the panel edge.
 *
 * **It was one flat fill, and it outweighed the line it was qualifying.** Now it
 * is two nested intervals — 50% inside 95% — at alphas well under the line's,
 * which is both quieter and strictly more informative: the inner band is where
 * the rate probably is, the outer is where it could be. The boundary is
 * smoothed through midpoints rather than drawn as a stair of straight segments.
 *
 * **The rate itself counted draws.** `won / counted` against the rest of the
 * product's `won / decided` — see `winRate` in `dashboard.ts`. This is why the
 * curve's own footer printed 50% two hundred pixels under a headline of 67%.
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
  const padB = 30;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const yFor = (rate: number): number => padT + plotH * (1 - Math.max(0, Math.min(1, rate)));

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

  /*
   * The plot is a groove, so it has a frame: a dark lip along the top-left and a
   * faint rim along the bottom-right, which is `.mat-well`'s inversion at chart
   * scale. Without it the fill met the panel with nothing between them and the
   * chart read as a sticker rather than as a recess in the surface.
   */
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.moveTo(padL + 0.5, padT + plotH);
  ctx.lineTo(padL + 0.5, padT + 0.5);
  ctx.lineTo(padL + plotW, padT + 0.5);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.055)";
  ctx.beginPath();
  ctx.moveTo(padL + plotW - 0.5, padT);
  ctx.lineTo(padL + plotW - 0.5, padT + plotH - 0.5);
  ctx.lineTo(padL, padT + plotH - 0.5);
  ctx.stroke();

  /*
   * The grid runs 0–100 rather than 25–75.
   *
   * A curve at 92% used to run through open space with no line above it, so a
   * reader had no way to tell 92 from 100 without measuring against the panel
   * edge — which is exactly the ambiguity the unclamped band then made worse.
   */
  ctx.font = "500 10px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const rate of [0, 0.25, 0.5, 0.75, 1]) {
    const bound = rate === 0 || rate === 1;
    const y = Math.round(yFor(rate)) + 0.5;
    ctx.strokeStyle = rate === 0.5 ? "rgba(255,255,255,0.2)" : bound ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.075)";
    ctx.lineWidth = 1;
    ctx.setLineDash(rate === 0.5 || bound ? [] : [3, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = rate === 0.5 ? "rgba(230,226,244,0.78)" : "rgba(164,156,194,0.72)";
    ctx.fillText(`${Math.round(rate * 100)}%`, padL - 7, y);
  }

  if (results.length === 0) return canvas;

  /*
   * Cumulative rate, oldest first — wins over *decided* matches, so a draw
   * advances the timeline without moving the rate. One definition; see
   * `winRate` in `dashboard.ts` for the three that used to be in the product.
   */
  const points: { x: number; rate: number; n: number; played: number }[] = [];
  let won = 0;
  let decided = 0;
  results.forEach((result, i) => {
    if (result === "win") won += 1;
    if (result !== "draw") decided += 1;
    const x = padL + (results.length === 1 ? plotW / 2 : (i / (results.length - 1)) * plotW);
    points.push({ x, rate: decided > 0 ? won / decided : 0, n: Math.max(1, decided), played: i + 1 });
  });

  /** A boundary of the interval, clamped to the scale, at `z` standard errors. */
  const boundOf = (point: { rate: number; n: number }, z: number, sign: 1 | -1): number => {
    const half = z * Math.sqrt(Math.max(0.02, point.rate * (1 - point.rate)) / point.n);
    return Math.max(0, Math.min(1, point.rate + sign * half));
  };

  /**
   * A polyline drawn through midpoints, so the boundary is a curve.
   *
   * The band is a stair by construction — each match moves the rate by a
   * discrete step — and drawing that stair with straight segments made the
   * uncertainty look like data. Quadratics anchored on the midpoint between
   * consecutive samples round it off without inventing values between them.
   */
  const traceSmooth = (xs: readonly number[], ys: readonly number[], reverse: boolean): void => {
    const order = reverse ? [...xs.keys()].reverse() : [...xs.keys()];
    order.forEach((index, step) => {
      const x = xs[index]!;
      const y = ys[index]!;
      if (step === 0) {
        ctx.lineTo(x, y);
        return;
      }
      const prev = order[step - 1]!;
      ctx.quadraticCurveTo(xs[prev]!, ys[prev]!, (xs[prev]! + x) / 2, (ys[prev]! + y) / 2);
      if (step === order.length - 1) ctx.lineTo(x, y);
    });
  };

  if (options.band !== false) {
    /*
     * Clipped to the plot, so no boundary can meet the panel edge no matter how
     * wide the interval is at three matches.
     */
    ctx.save();
    ctx.beginPath();
    ctx.rect(padL, padT, plotW, plotH);
    ctx.clip();

    const xs = points.map((point) => point.x);
    // 95% outside, 50% inside: where it could be, and where it probably is.
    for (const [z, alpha] of [
      [1.96, "16"],
      [0.674, "20"],
    ] as const) {
      const upper = points.map((point) => yFor(boundOf(point, z, 1)));
      const lower = points.map((point) => yFor(boundOf(point, z, -1)));
      ctx.beginPath();
      ctx.moveTo(xs[0]!, upper[0]!);
      traceSmooth(xs, upper, false);
      ctx.lineTo(xs[xs.length - 1]!, lower[lower.length - 1]!);
      traceSmooth(xs, lower, true);
      ctx.closePath();
      ctx.fillStyle = `${accent}${alpha}`;
      ctx.fill();
    }

    // the outer boundary as a hairline, so the band ends rather than stops
    const edge = points.map((point) => yFor(boundOf(point, 1.96, 1)));
    const floorLine = points.map((point) => yFor(boundOf(point, 1.96, -1)));
    ctx.strokeStyle = `${accent}33`;
    ctx.lineWidth = 1;
    for (const series of [edge, floorLine]) {
      ctx.beginPath();
      ctx.moveTo(xs[0]!, series[0]!);
      traceSmooth(xs, series, false);
      ctx.stroke();
    }
    ctx.restore();
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

  /*
   * X ticks with match numbers, so "30 matches, oldest first" is measurable
   * rather than asserted. Four at most — enough to read the axis, few enough
   * that the labels never collide at 320px.
   */
  const ticks = Math.min(4, results.length);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(164,156,194,0.62)";
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i < ticks; i++) {
    const point = points[Math.round((i / Math.max(1, ticks - 1)) * (points.length - 1))]!;
    const x = Math.round(point.x) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, padT + plotH);
    ctx.lineTo(x, padT + plotH + 3);
    ctx.stroke();
    ctx.fillText(String(point.played), Math.min(padL + plotW - 8, Math.max(padL + 8, x)), padT + plotH + 5);
  }

  // the footer says what is counted and what the figure means, in one place
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(164,156,194,0.85)";
  ctx.fillText(`${results.length} matches, oldest first`, padL + 2, height - 9);
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(230,226,244,0.9)";
  ctx.fillText(`${Math.round(last.rate * 100)}% of ${last.n} decided`, padL + plotW, height - 9);

  return canvas;
}
