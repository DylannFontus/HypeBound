/**
 * Pictures of rewards, and the queue that keeps them off the navigation frame.
 *
 * Two problems share one file because they are the same problem seen from two
 * ends.
 *
 * ## The measurement that forced the queue
 *
 * `lobby → banner` blocked the main thread for **637ms** in one task and 310ms
 * in another, with a 640ms gap between painted frames, and `nav-descend-out`
 * fired `animationstart` and `animationend` **on the same millisecond** — the
 * descend was authored, mounted and never rendered, because the compositor was
 * frozen for the whole of its 300ms. The other four routes cost 146–315ms on
 * entry for the same reason. Every millisecond of it was a canvas: seven
 * `renderCardToCanvas` passes on the banner, five `renderCardBackToCanvas` plus
 * a PNG encode on the Hype Wave, nine struck badges on the achievements screen,
 * one 282×374 card back on the shop.
 *
 * `packOpening.ts` already knew the answer and wrote it down at :376 — *paint no
 * canvas on the frame the player acted on; run a queue that is slower than the
 * animation.* The same discipline simply had never been applied to a screen's
 * own first paint. So every expensive picture in this domain is now declared as
 * a **spec string** in the markup, and {@link paintRewardArt} fills them in
 * afterwards, one slice at a time, starting after the descend has finished.
 *
 * A spec that has already been drawn once is a map lookup, so the second visit
 * to a screen is free and paints inside the same frame as the markup.
 *
 * ## The census that forced the drawings
 *
 * 107 reward tiles on the Hype Wave; **86** of them were one of two identical
 * glyphs — 47 copies of the same four-point sparkle labelled "Minor seasonal
 * cosmetic" and 39 copies of the same coin. Four tiles rendered an actual
 * preview, and those four were the card backs, because a card back is the one
 * cosmetic the game already knew how to draw. Both achievement milestone
 * frames — "Trophy Shelf" and "Full Wall" — came out as the identical generic
 * person mark, so you could not tell which one you were working toward.
 *
 * A reward you cannot see is not a reward. Hearthstone's Rewards Track shows a
 * chest; MTG Arena's Mastery Pass draws every node's item; Gwent's Journey puts
 * a portrait at each milestone. None of them needs new art here either: a frame
 * is a ring round an avatar plate, a battlefield is a lit floor under two
 * spotlights, a leader skin is a bust in a portrait arch, a title is an engraved
 * name plate. They are drawn from the cosmetic's own colour and emblem — the
 * same two fields the card back has always been drawn from — so a new season
 * gets a full set of previews the moment it gets a palette.
 *
 * Where the data genuinely has nothing concrete, the medallion is tinted from
 * the season's own ramp by tier band, so a rail of fifty reads as a progression
 * rather than as one sparkle photocopied forty-seven times.
 *
 * Everything is lit from 315°, like everything else in the game.
 */

import type { CardBackStyle, EmblemShape } from "../../cosmetics/emblem";
import { drawEmblem, hexToRgb } from "../../cosmetics/emblem";
import { renderCardBackToCanvas } from "../../cardRenderer/renderCardBack";
import { achievementBadge, type BadgeState } from "./achievementBadge";

/* -------------------------------------------------------------------------
   the queue
   ------------------------------------------------------------------------- */

/**
 * How long after a screen mounts the first picture may be drawn.
 *
 * §3a budgets a menu transition at 260–420ms. Anything expensive landing inside
 * that window is a long task on the transition itself, which is precisely the
 * defect this file exists to remove — so the queue does not start until the
 * descend is over and the incoming screen has settled on its own frame.
 */
const QUEUE_START_MS = 440;

/**
 * The floor on the gap between two slices.
 *
 * The ceiling is set by the work itself: a slice that blocked for 90ms is
 * followed by a 90ms pause, so the queue always hands back at least as much
 * thread as it took. That self-tuning is the difference between a queue and a
 * chain of `requestAnimationFrame` calls, which is what the pack opening tried
 * first and which simply moved five long tasks into the animation.
 */
const QUEUE_STEP_MS = 34;
const QUEUE_STEP_MAX = 260;

export interface PaintQueue {
  /** Add work. Jobs run in the order they were added. */
  push: (job: () => void) => void;
  /** Abandon everything still pending — a screen that navigated away. */
  stop: () => void;
}

/**
 * A queue that is deliberately slower than the animation it is hiding behind.
 *
 * `start` is measured from the moment the queue is created, which is the moment
 * the screen's markup went into the document.
 */
export function createPaintQueue(options: { start?: number; step?: number } = {}): PaintQueue {
  const jobs: (() => void)[] = [];
  const step = options.step ?? QUEUE_STEP_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let armed = false;

  const run = (): void => {
    timer = null;
    if (stopped) return;
    const job = jobs.shift();
    if (!job) {
      armed = false;
      return;
    }
    const began = performance.now();
    try {
      job();
    } catch {
      // A picture that will not draw is a missing preview, never a dead screen.
    }
    const cost = performance.now() - began;
    timer = globalThis.setTimeout(run, Math.min(QUEUE_STEP_MAX, Math.max(step, cost)));
  };

  return {
    push: (job) => {
      if (stopped) return;
      jobs.push(job);
      if (armed) return;
      armed = true;
      timer = globalThis.setTimeout(run, options.start ?? QUEUE_START_MS);
    },
    stop: () => {
      stopped = true;
      jobs.length = 0;
      if (timer !== null) globalThis.clearTimeout(timer);
      timer = null;
    },
  };
}

/* -------------------------------------------------------------------------
   the drawings
   ------------------------------------------------------------------------- */

/** Logical size of every reward object. Drawn once, scaled by CSS thereafter. */
const ART = 112;

const cache = new Map<string, string>();

/** Which object a spec asks for. The string form is what survives into markup. */
export type ArtMotif =
  | "back"
  | "achbadge"
  | "frame"
  | "portrait"
  | "venue"
  | "title"
  | "emote"
  | "music"
  | "variant"
  | "badge"
  | "medallion"
  | "pick";

/**
 * A drawing request, as a string, because it has to travel through `innerHTML`.
 *
 * `motif|colour|emblem|band` — four fields, all of them plain, so the whole
 * pipeline is a `data-` attribute and a `Map` rather than a registry of
 * closures somebody has to remember to clear.
 */
export function artSpec(motif: ArtMotif, colour: string, emblem: EmblemShape = "diamond", band = 0): string {
  return `${motif}|${colour}|${emblem}|${band}`;
}

/** Draw a spec, or hand back the bitmap already drawn for it. `""` on failure. */
export function resolveArt(spec: string): string {
  const hit = cache.get(spec);
  if (hit !== undefined) return hit;
  let uri = "";
  try {
    uri = draw(spec);
  } catch {
    uri = "";
  }
  cache.set(spec, uri);
  return uri;
}

/** Whether a spec is already in hand — the screens use it to skip the queue. */
export const artIsReady = (spec: string): boolean => cache.has(spec);

/**
 * The real card back, as a bitmap, at one twentieth the cost of a canvas each.
 *
 * The pass shows a card back on five tiers, the check-in track on one, the
 * banner on its first-ten reward and the shop uses one as the pack it sells —
 * so a naive canvas per tile is a dozen 512×680 rasterisations for one screen.
 * It lives here rather than beside its callers so that it shares the cache, the
 * spec strings and the queue with every other reward picture: the whole point
 * of the queue is that one list decides what gets drawn and when.
 */
export function cardBackSpec(style: CardBackStyle, scale = 0.32): string {
  return `back|${style.color}|${style.emblem}|${Math.round(scale * 100)}`;
}

/**
 * A struck achievement badge, through the same queue as everything else.
 *
 * `achievementBadge` has its own cache and its own drawing, and rightly so —
 * nine bitmaps for the whole game. What it did not have was anywhere to be
 * *deferred to*: the achievements screen struck all nine inside `render()`, for
 * a measured 226ms long task on arrival with a 227ms gap between painted
 * frames. The spec form is the only thing this adds.
 */
export function badgeSpec(points: number, state: BadgeState): string {
  return `achbadge|${state}|diamond|${points}`;
}

function draw(spec: string): string {
  const [motif, colour = "#b56cff", emblem = "diamond", bandRaw = "0"] = spec.split("|");
  if (typeof document === "undefined") return "";
  if (motif === "back") {
    const scale = (Number(bandRaw) || 32) / 100;
    return renderCardBackToCanvas({ color: colour, emblem: emblem as EmblemShape }, scale).toDataURL("image/png");
  }
  if (motif === "achbadge") return achievementBadge(Number(bandRaw) || 0, colour as BadgeState);
  const dpr = Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(ART * dpr);
  canvas.height = Math.round(ART * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.scale(dpr, dpr);

  const ink = hexToRgb(colour);
  const band = Number(bandRaw) || 0;
  const paint = { ctx, ink, emblem: emblem as EmblemShape, band };

  plate(paint);
  switch (motif as ArtMotif) {
    case "frame":
      frameMotif(paint);
      break;
    case "portrait":
      portraitMotif(paint);
      break;
    case "venue":
      venueMotif(paint);
      break;
    case "title":
      titleMotif(paint);
      break;
    case "emote":
      emoteMotif(paint);
      break;
    case "music":
      musicMotif(paint);
      break;
    case "variant":
      variantMotif(paint);
      break;
    case "pick":
      pickMotif(paint);
      break;
    case "back":
    case "achbadge":
    case "badge":
    case "medallion":
    default:
      medallionMotif(paint);
      break;
  }
  bevel(paint);
  return canvas.toDataURL("image/png");
}

interface Paint {
  ctx: CanvasRenderingContext2D;
  ink: [number, number, number];
  emblem: EmblemShape;
  band: number;
}

const rgb = (c: [number, number, number], a = 1): string => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** Lighten toward white by `t`, so one colour makes a whole lit ramp. */
const lift = (c: [number, number, number], t: number): [number, number, number] => [
  Math.round(c[0] + (255 - c[0]) * t),
  Math.round(c[1] + (255 - c[1]) * t),
  Math.round(c[2] + (255 - c[2]) * t),
];

const sink = (c: [number, number, number], t: number): [number, number, number] => [
  Math.round(c[0] * (1 - t)),
  Math.round(c[1] * (1 - t)),
  Math.round(c[2] * (1 - t)),
];

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * The alcove every motif stands in.
 *
 * A recess rather than a raised plate, because the object *inside* it is the
 * thing that should read as raised — the recon's complaint was that the tiles
 * were the darkest objects on the panel, and the cure for that is not a lighter
 * hole, it is something bright standing in the hole.
 */
function plate({ ctx, ink }: Paint): void {
  const wall = ctx.createLinearGradient(0, 0, ART, ART);
  wall.addColorStop(0, rgb(sink(ink, 0.58), 0.95));
  wall.addColorStop(0.55, rgb(sink(ink, 0.78), 0.98));
  wall.addColorStop(1, rgb(sink(ink, 0.86), 1));
  ctx.fillStyle = wall;
  rounded(ctx, 1, 1, ART - 2, ART - 2, 15);
  ctx.fill();

  // the pool of light the object stands in, top-left as always
  const pool = ctx.createRadialGradient(ART * 0.34, ART * 0.28, 2, ART * 0.5, ART * 0.5, ART * 0.72);
  pool.addColorStop(0, rgb(lift(ink, 0.35), 0.34));
  pool.addColorStop(1, rgb(ink, 0));
  ctx.fillStyle = pool;
  rounded(ctx, 1, 1, ART - 2, ART - 2, 15);
  ctx.fill();
}

/** The rim light on the top-left edge and the lip on the bottom-right. */
function bevel({ ctx }: Paint): void {
  ctx.lineWidth = 1.6;
  const rim = ctx.createLinearGradient(0, 0, ART, ART);
  rim.addColorStop(0, "rgba(255,255,255,0.34)");
  rim.addColorStop(0.5, "rgba(255,255,255,0.05)");
  rim.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.strokeStyle = rim;
  rounded(ctx, 1.2, 1.2, ART - 2.4, ART - 2.4, 14.5);
  ctx.stroke();
}

/** Common set-up for a struck object: a lit body with a dark underside. */
function bodyFill(ctx: CanvasRenderingContext2D, ink: [number, number, number], x0: number, y0: number, x1: number, y1: number): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, rgb(lift(ink, 0.62), 1));
  g.addColorStop(0.42, rgb(ink, 1));
  g.addColorStop(1, rgb(sink(ink, 0.55), 1));
  return g;
}

/** A profile frame: the ring you wear, drawn round the avatar plate it rings. */
function frameMotif({ ctx, ink, emblem }: Paint): void {
  const cx = ART / 2;
  const cy = ART / 2;

  // the avatar underneath — a bust plate, deliberately neutral so the ring reads
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, 30, 0, Math.PI * 2);
  ctx.clip();
  const skin = ctx.createLinearGradient(cx - 26, cy - 26, cx + 26, cy + 26);
  skin.addColorStop(0, "rgba(122,112,152,0.95)");
  skin.addColorStop(1, "rgba(38,32,58,0.98)");
  ctx.fillStyle = skin;
  ctx.fillRect(cx - 32, cy - 32, 64, 64);
  ctx.fillStyle = "rgba(18,14,30,0.9)";
  ctx.beginPath();
  ctx.arc(cx, cy - 6, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy + 24, 20, 14, 0, Math.PI, 0);
  ctx.fill();
  ctx.restore();

  // the ring itself, which is the reward
  ctx.lineWidth = 7;
  ctx.strokeStyle = bodyFill(ctx, ink, cx - 38, cy - 38, cx + 38, cy + 38);
  ctx.beginPath();
  ctx.arc(cx, cy, 34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.beginPath();
  ctx.arc(cx, cy, 37.5, Math.PI * 0.9, Math.PI * 1.75);
  ctx.stroke();

  // four studs on the diagonals, the frame's own hardware
  for (const angle of [0.25, 0.75, 1.25, 1.75]) {
    const a = angle * Math.PI;
    ctx.fillStyle = rgb(lift(ink, 0.55), 1);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * 34, cy + Math.sin(a) * 34, 4.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // the mark, small, at the crown
  ctx.save();
  ctx.translate(0, -6);
  ctx.strokeStyle = rgb(lift(ink, 0.7), 0.95);
  ctx.lineWidth = 2.4;
  drawEmblem(ctx, emblem, cx, cy - 24, 0.1);
  ctx.restore();
}

/** A leader skin, an animated portrait: a bust lit inside a portrait arch. */
function portraitMotif({ ctx, ink }: Paint): void {
  const x = 26;
  const y = 16;
  const w = ART - 52;
  const h = ART - 30;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + 26);
  ctx.arcTo(x, y, x + w / 2, y, 26);
  ctx.arcTo(x + w, y, x + w, y + 26, 26);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.clip();

  const room = ctx.createLinearGradient(x, y, x + w, y + h);
  room.addColorStop(0, rgb(lift(ink, 0.4), 0.95));
  room.addColorStop(1, rgb(sink(ink, 0.72), 1));
  ctx.fillStyle = room;
  ctx.fillRect(x, y, w, h);

  // the figure: a head and shoulders, back-lit so it reads as a silhouette
  ctx.fillStyle = "rgba(10,6,20,0.82)";
  ctx.beginPath();
  ctx.arc(x + w / 2, y + 36, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + w / 2 - 30, y + h);
  ctx.quadraticCurveTo(x + w / 2, y + 50, x + w / 2 + 30, y + h);
  ctx.closePath();
  ctx.fill();

  // the rim light on the figure's lit side, which is what makes it a portrait
  ctx.strokeStyle = rgb(lift(ink, 0.8), 0.9);
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(x + w / 2, y + 36, 15, Math.PI * 0.95, Math.PI * 1.6);
  ctx.stroke();
  ctx.restore();

  // the arch's own moulding
  ctx.strokeStyle = bodyFill(ctx, ink, x, y, x + w, y + h);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + 26);
  ctx.arcTo(x, y, x + w / 2, y, 26);
  ctx.arcTo(x + w, y, x + w, y + 26, 26);
  ctx.lineTo(x + w, y + h);
  ctx.stroke();
}

/** A battlefield: the mat, seen from the side of the room the light is on. */
function venueMotif({ ctx, ink }: Paint): void {
  const horizon = 54;
  ctx.save();
  rounded(ctx, 12, 18, ART - 24, ART - 40, 8);
  ctx.clip();

  const sky = ctx.createLinearGradient(12, 18, ART - 12, horizon);
  sky.addColorStop(0, rgb(lift(ink, 0.42), 0.95));
  sky.addColorStop(1, rgb(sink(ink, 0.6), 0.98));
  ctx.fillStyle = sky;
  ctx.fillRect(12, 18, ART - 24, horizon - 18);

  // two spotlight cones, because a venue is a lit place before it is a floor
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  for (const cx of [36, 76]) {
    ctx.beginPath();
    ctx.moveTo(cx, 20);
    ctx.lineTo(cx - 16, horizon + 22);
    ctx.lineTo(cx + 16, horizon + 22);
    ctx.closePath();
    ctx.fill();
  }

  const floor = ctx.createLinearGradient(0, horizon, 0, ART - 22);
  floor.addColorStop(0, rgb(lift(ink, 0.2), 0.95));
  floor.addColorStop(1, rgb(sink(ink, 0.82), 1));
  ctx.fillStyle = floor;
  ctx.fillRect(12, horizon, ART - 24, ART - 40 - (horizon - 18));

  // perspective lines on the mat
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1;
  for (const offset of [-38, -14, 14, 38]) {
    ctx.beginPath();
    ctx.moveTo(ART / 2 + offset * 0.32, horizon);
    ctx.lineTo(ART / 2 + offset * 1.5, ART - 22);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255,255,255,0.24)";
  ctx.beginPath();
  ctx.moveTo(12, horizon + 0.5);
  ctx.lineTo(ART - 12, horizon + 0.5);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = bodyFill(ctx, ink, 12, 18, ART - 12, ART - 22);
  ctx.lineWidth = 3;
  rounded(ctx, 12, 18, ART - 24, ART - 40, 8);
  ctx.stroke();
}

/** A title: the engraved name plate it is worn on. */
function titleMotif({ ctx, ink }: Paint): void {
  const y = 34;
  const h = 44;
  ctx.fillStyle = bodyFill(ctx, ink, 12, y, ART - 12, y + h);
  rounded(ctx, 12, y, ART - 24, h, 7);
  ctx.fill();

  // the two swallowtails that make a plate a banner
  ctx.beginPath();
  ctx.moveTo(12, y);
  ctx.lineTo(2, y + h / 2);
  ctx.lineTo(12, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(ART - 12, y);
  ctx.lineTo(ART - 2, y + h / 2);
  ctx.lineTo(ART - 12, y + h);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 1.2;
  rounded(ctx, 14, y + 2, ART - 28, h - 4, 5);
  ctx.stroke();

  // engraved lettering, as bars — a word here would be a word in a font we
  // cannot promise, and the tile already carries the real name underneath it
  ctx.fillStyle = "rgba(8,5,16,0.62)";
  for (const [bx, bw] of [[24, 26], [56, 16], [76, 12]] as const) {
    rounded(ctx, bx, y + 15, bw, 6, 3);
    ctx.fill();
  }
  ctx.fillStyle = rgb(lift(ink, 0.75), 0.7);
  rounded(ctx, 24, y + 27, 40, 4, 2);
  ctx.fill();
}

/** An emote: the bubble it is said in, with the faction's mark inside it. */
function emoteMotif({ ctx, ink, emblem }: Paint): void {
  ctx.fillStyle = bodyFill(ctx, ink, 14, 18, ART - 14, 82);
  rounded(ctx, 14, 18, ART - 28, 58, 14);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(34, 74);
  ctx.lineTo(30, 94);
  ctx.lineTo(52, 74);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 1.3;
  rounded(ctx, 15.5, 19.5, ART - 31, 55, 13);
  ctx.stroke();

  ctx.save();
  ctx.strokeStyle = "rgba(10,6,18,0.6)";
  ctx.lineWidth = 3;
  drawEmblem(ctx, emblem, ART / 2, 47, 0.2);
  ctx.restore();
}

/** A music pack: a pressed disc with a groove and a level trace across it. */
function musicMotif({ ctx, ink }: Paint): void {
  const cx = ART / 2;
  const cy = 50;
  ctx.fillStyle = bodyFill(ctx, ink, cx - 32, cy - 32, cx + 32, cy + 32);
  ctx.beginPath();
  ctx.arc(cx, cy, 31, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(0,0,0,0.32)";
  ctx.lineWidth = 1;
  for (const r of [12, 18, 24]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(10,6,18,0.85)";
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.42)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(cx, cy, 31, Math.PI * 0.95, Math.PI * 1.6);
  ctx.stroke();

  // the level trace under it, so the object says "sound" and not "wheel"
  ctx.fillStyle = rgb(lift(ink, 0.6), 0.95);
  const bars = [7, 14, 9, 18, 11, 20, 8, 13];
  bars.forEach((height, index) => {
    const x = 20 + index * 9.5;
    rounded(ctx, x, 96 - height, 5, height, 2.5);
    ctx.fill();
  });
}

/** An alternate-art variant: a card with the foil running across it. */
function variantMotif({ ctx, ink }: Paint): void {
  const x = 30;
  const y = 14;
  const w = 52;
  const h = 74;
  ctx.save();
  rounded(ctx, x, y, w, h, 6);
  ctx.clip();
  const face = ctx.createLinearGradient(x, y, x + w, y + h);
  face.addColorStop(0, rgb(lift(ink, 0.5), 1));
  face.addColorStop(1, rgb(sink(ink, 0.7), 1));
  ctx.fillStyle = face;
  ctx.fillRect(x, y, w, h);

  // the art window and the text box, so it reads as a card and not as a tile
  ctx.fillStyle = "rgba(8,5,16,0.5)";
  rounded(ctx, x + 6, y + 8, w - 12, 32, 3);
  ctx.fill();
  rounded(ctx, x + 6, y + 46, w - 12, 20, 3);
  ctx.fill();

  const foil = ctx.createLinearGradient(x - 10, y + h, x + w + 10, y);
  foil.addColorStop(0.28, "rgba(255,255,255,0)");
  foil.addColorStop(0.44, "rgba(255,255,255,0.55)");
  foil.addColorStop(0.52, "rgba(180,255,240,0.42)");
  foil.addColorStop(0.68, "rgba(255,255,255,0)");
  ctx.fillStyle = foil;
  ctx.fillRect(x, y, w, h);
  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,0.34)";
  ctx.lineWidth = 1.5;
  rounded(ctx, x + 0.7, y + 0.7, w - 1.4, h - 1.4, 6);
  ctx.stroke();

  ctx.fillStyle = rgb(lift(ink, 0.7), 0.9);
  for (const [sx, sy, r] of [[86, 24, 4], [24, 62, 3], [90, 74, 2.4]] as const) {
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(sx + Math.cos(a) * r * 2.6, sy + Math.sin(a) * r * 2.6);
      const b = a + Math.PI / 4;
      ctx.lineTo(sx + Math.cos(b) * r * 0.7, sy + Math.sin(b) * r * 0.7);
    }
    ctx.closePath();
    ctx.fill();
  }
}

/** A choice of cards: three fanned, the pick's rarity on the front one. */
function pickMotif({ ctx, ink }: Paint): void {
  const draws: [number, number, number][] = [
    [-22, 8, -0.22],
    [22, 8, 0.22],
    [0, 0, 0],
  ];
  for (const [dx, dy, rot] of draws) {
    ctx.save();
    ctx.translate(ART / 2 + dx, ART / 2 + dy + 4);
    ctx.rotate(rot);
    const w = 40;
    const h = 58;
    const face = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
    face.addColorStop(0, rgb(lift(ink, rot === 0 ? 0.55 : 0.2), 1));
    face.addColorStop(1, rgb(sink(ink, rot === 0 ? 0.55 : 0.74), 1));
    ctx.fillStyle = face;
    rounded(ctx, -w / 2, -h / 2, w, h, 5);
    ctx.fill();
    ctx.strokeStyle = rot === 0 ? "rgba(255,255,255,0.42)" : "rgba(255,255,255,0.16)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    if (rot === 0) {
      ctx.fillStyle = "rgba(8,5,16,0.45)";
      rounded(ctx, -w / 2 + 5, -h / 2 + 6, w - 10, 24, 3);
      ctx.fill();
      // the rarity gem, which is the only thing that distinguishes one pick
      // from another and is therefore the brightest object on the tile
      ctx.fillStyle = rgb(lift(ink, 0.72), 1);
      ctx.beginPath();
      ctx.moveTo(0, 8);
      ctx.lineTo(7, 17);
      ctx.lineTo(0, 26);
      ctx.lineTo(-7, 17);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

/**
 * The seasonal medallion — the honest answer where the data has no object.
 *
 * Struck from the season's own emblem, and tinted by tier band, so the filler
 * that pays out thirty-five times across a fifty tier track reads as a
 * progression of five trims rather than as one sparkle repeated. Five, not
 * fifty: a bitmap per tier would be fifty rasterisations for one screen, and
 * the eye reads a change every ten tiers as rhythm and a change every tier as
 * noise.
 */
function medallionMotif({ ctx, ink, emblem, band }: Paint): void {
  const cx = ART / 2;
  const cy = ART / 2;
  const r = 34;
  const sides = 6;

  const hex = (radius: number): void => {
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = -Math.PI / 2 + (i / sides) * Math.PI * 2;
      const px = cx + Math.cos(a) * radius;
      const py = cy + Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  };

  ctx.fillStyle = bodyFill(ctx, ink, cx - r, cy - r, cx + r, cy + r);
  hex(r);
  ctx.fill();

  // a milled collar, and its count is the band — the rhythm the rail needed
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 1.4;
  hex(r - 4.5);
  ctx.stroke();
  ctx.fillStyle = rgb(lift(ink, 0.6), 0.95);
  const studs = 3 + Math.min(3, band);
  for (let i = 0; i < studs; i++) {
    const a = -Math.PI / 2 + (i / studs) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2), 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // the well the mark is sunk into
  const well = ctx.createLinearGradient(cx - 22, cy - 22, cx + 22, cy + 22);
  well.addColorStop(0, rgb(sink(ink, 0.72), 1));
  well.addColorStop(1, rgb(sink(ink, 0.4), 1));
  ctx.fillStyle = well;
  hex(r - 9);
  ctx.fill();

  ctx.save();
  ctx.strokeStyle = rgb(lift(ink, 0.78), 0.95);
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  drawEmblem(ctx, emblem, cx, cy, 0.2);
  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.5, cy - r * 0.84);
  ctx.lineTo(cx - r * 0.98, cy - r * 0.02);
  ctx.stroke();
}

/* -------------------------------------------------------------------------
   filling the markup
   ------------------------------------------------------------------------- */

/**
 * Fill every `[data-rw-art]` under `root`, cheaply if it can and later if not.
 *
 * Grouped by spec, because a Hype Wave track holds 107 tiles drawn from about a
 * dozen distinct objects — resolving per element would be a hundred cache
 * lookups and, on the first visit, a hundred queue slices for twelve drawings.
 *
 * Specs already in the cache are filled synchronously: a re-render caused by a
 * claim must not make the whole screen's artwork fade back in, and the second
 * visit to a screen should look identical to the first one settled.
 */
export function paintRewardArt(root: ParentNode, queue?: PaintQueue): void {
  const pending = new Map<string, HTMLElement[]>();
  for (const host of root.querySelectorAll<HTMLElement>("[data-rw-art]")) {
    const spec = host.dataset["rwArt"];
    if (!spec) continue;
    const group = pending.get(spec);
    if (group) group.push(host);
    else pending.set(spec, [host]);
  }

  for (const [spec, hosts] of pending) {
    if (artIsReady(spec)) {
      fill(spec, hosts, false);
      continue;
    }
    if (!queue) {
      fill(spec, hosts, false);
      continue;
    }
    queue.push(() => fill(spec, hosts, true));
  }
}

function fill(spec: string, hosts: readonly HTMLElement[], fade: boolean): void {
  const uri = resolveArt(spec);
  if (!uri) return;
  for (const host of hosts) {
    if (!host.isConnected) continue;
    const image = document.createElement("img");
    image.src = uri;
    image.alt = "";
    image.decoding = "async";
    image.draggable = false;
    // Nothing pops in — §7. The icon that was standing in goes on the same
    // frame the picture arrives, so the tile never holds both.
    if (fade) image.className = "rw-art-in";
    host.replaceChildren(image);
    delete host.dataset["rwArt"];
  }
}
