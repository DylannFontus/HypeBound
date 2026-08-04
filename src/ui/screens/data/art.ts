/**
 * The picture layer for the data screens.
 *
 * Recon scored this domain 4.5/10 and named one cause above every other: *there
 * are no pictures anywhere*. The profile avatar was `displayName.charAt(0)` on a
 * grey disc, the ten faction Mastery tiles carried no crest and no colour, event
 * "key art" was a two-stop radial gradient with a currency glyph in it, news
 * articles had no hero, the reward ladder drew a Faction Pack as a grey text
 * pill, and the leaderboard had no medal. Nine screens of database admin panel
 * in a neon gradient.
 *
 * So this module paints. Everything here is **canvas, procedural, memoised and
 * offline** — no fetch, no asset, no dependency — and every piece is built from
 * the same five ingredients in the same order, which is what makes a crest, an
 * event banner and a reward tile read as the same world rather than as five
 * people's homework:
 *
 *   1. a **base** two-stop gradient along the 315° key vector;
 *   2. a **shaft** of light entering from the top-left corner, the same corner
 *      every bevel in `foundation.css` is lit from;
 *   3. a **pattern** — the faction's own emblem, tiled, at 5–8%, so the surface
 *      has something in it other than mathematics;
 *   4. a **vignette** plus a floor pool, so the plate is a lit place rather than
 *      a rectangle of colour;
 *   5. **grain**, taken from module B's generator rather than a second one, so
 *      the dirt on an event banner is literally the dirt on the battle mat.
 *
 * ## What this is emphatically not
 *
 * **It never touches card art.** `AAA-BAR.md` §10 is absolute: paintings arrive
 * as PNGs a human made, and nothing may synthesise into that space. The one
 * place here that shows a card painting — the profile avatar — *reads* an
 * already-loaded PNG through `paintLeaderPortrait` and falls back to the card
 * renderer's own long-lived placeholder. It draws no card art of its own.
 *
 * ## Why data URIs and not elements
 *
 * A `background-image` composes with the material system: a crest can sit under
 * a `.mat-panel`'s own gradient, rim and grain without the panel needing to know
 * it is there, and a hover can move it with `transform` on the host. An element
 * would have to be positioned, layered and z-indexed on every one of the nine
 * screens. The cache is keyed on every argument, because these are called once
 * per list row and a mastery grid is ten of them.
 */

import type { FactionId } from "../../../engine/types";
import { FACTION_COLOR } from "../../cardRenderer/palette";
import { drawEmblem, hexToRgb, type EmblemShape } from "../../cosmetics/emblem";
import { cosmeticsData } from "../../../game/cosmetics/data";
import { LIGHT_RIG, noiseTexture } from "../../art/texture";

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * One map, keyed by the full argument list.
 *
 * Bounded rather than open, because the news hero takes a per-article seed and a
 * player who reads forty articles should not be holding forty 640×220 bitmaps as
 * base64 strings. 96 is comfortably more than any one screen asks for and small
 * enough that the worst case is a few megabytes of string.
 */
const CACHE = new Map<string, string>();
const CACHE_MAX = 96;

function cached(key: string, make: () => string): string {
  const hit = CACHE.get(key);
  if (hit !== undefined) {
    // touch: re-insert so the eviction below drops the genuinely coldest entry
    CACHE.delete(key);
    CACHE.set(key, hit);
    return hit;
  }
  const value = make();
  CACHE.set(key, value);
  if (CACHE.size > CACHE_MAX) {
    const oldest = CACHE.keys().next().value;
    if (oldest !== undefined) CACHE.delete(oldest);
  }
  return value;
}

/** Drop everything. Tests only — a screen has no reason to invalidate art. */
export function resetArtCache(): void {
  CACHE.clear();
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

/** The key light, as a canvas gradient vector across a w×h box. */
function keyVector(w: number, h: number): [number, number, number, number] {
  // 315° in CSS gradient terms is a ramp running from the top-left corner to
  // the bottom-right one. `LIGHT_RIG.cssAngle` is the single source; the
  // conversion is written out rather than hard-coded so a change there moves
  // this too.
  const radians = ((LIGHT_RIG.cssAngle - 90) * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const half = Math.hypot(w, h) / 2;
  return [w / 2 + dx * half, h / 2 + dy * half, w / 2 - dx * half, h / 2 - dy * half];
}

const rgba = (hex: string, alpha: number): string => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/** Darken toward the void rather than toward grey — nightlife has no grey. */
function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (channel: number, floor: number): number => Math.round(channel * (1 - amount) + floor * amount);
  return `rgb(${mix(r, 8)}, ${mix(g, 4)}, ${mix(b, 20)})`;
}

/**
 * One scratch surface, reused, rather than twenty-three fresh ones.
 *
 * Every piece here is drawn once and immediately encoded to a `data:` URI, so
 * nothing needs to keep its canvas — and keeping one is measurably cheaper than
 * allocating one per piece. A fresh `<canvas>` is a fresh backing surface, and
 * the first `toDataURL` on it is a synchronisation point; twenty-three of those
 * on the frame the Mastery grid mounts measured **330ms of blocked main thread**
 * on a cold cache, which is a visible hitch on exactly the frame the entrance
 * cascade is trying to play. Reusing the surface keeps one allocation hot.
 *
 * Setting `width` clears the canvas, which is what makes the reuse safe: every
 * piece starts from a blank surface whether or not the last one was the same
 * size.
 */
let scratch: HTMLCanvasElement | null = null;

function surface(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = scratch ?? (scratch = document.createElement("canvas"));
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

/** Ingredient 1 — the lit base. */
function base(ctx: CanvasRenderingContext2D, w: number, h: number, accent: string): void {
  const [x0, y0, x1, y1] = keyVector(w, h);
  const ramp = ctx.createLinearGradient(x0, y0, x1, y1);
  ramp.addColorStop(0, shade(accent, 0.62));
  ramp.addColorStop(0.55, shade(accent, 0.86));
  ramp.addColorStop(1, "#07040f");
  ctx.fillStyle = ramp;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Ingredient 2 — a shaft of light entering the top-left corner.
 *
 * This is the piece that makes a flat fill read as a room. It is a soft cone
 * rather than a radial glow because a cone has a direction, and the direction is
 * the same 315° the whole game is lit from: put a crest beside a `.mat-panel`
 * and the two catch the light in the same place.
 */
function shaft(ctx: CanvasRenderingContext2D, w: number, h: number, accent: string, strength: number): void {
  ctx.save();
  const reach = Math.hypot(w, h);
  const cone = ctx.createRadialGradient(w * 0.06, h * -0.1, 0, w * 0.06, h * -0.1, reach * 0.92);
  cone.addColorStop(0, rgba(accent, 0.5 * strength));
  cone.addColorStop(0.32, rgba(accent, 0.2 * strength));
  cone.addColorStop(1, "rgba(0,0,0,0)");
  /*
   * `lighter` above a threshold, plain compositing below it.
   *
   * Additive blending is the right answer for a 1024px banner and a measurably
   * wrong one for a 104px crest: on the software rasteriser a `lighter` fill is
   * roughly ten times the cost of a `source-over` one, and the *mastery grid
   * makes twenty-three of these at once*. Measured cold, the grid's art layer
   * was 330ms of blocked main thread on first entry — a visible hitch on the
   * one frame the entrance cascade is trying to play. At crest scale the two
   * modes are visually indistinguishable, because the plate under the cone is
   * nearly black either way.
   */
  ctx.globalCompositeOperation = reach > 400 ? "lighter" : "source-over";
  ctx.fillStyle = cone;
  ctx.beginPath();
  ctx.moveTo(-w * 0.3, -h * 0.2);
  ctx.lineTo(w * 0.72, -h * 0.2);
  ctx.lineTo(w * 1.05, h * 1.2);
  ctx.lineTo(-w * 0.3, h * 1.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Ingredient 3 — the faction's own mark, tiled, barely there. */
function pattern(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  emblem: EmblemShape,
  accent: string,
  step: number,
  alpha: number
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = rgba(accent, 1);
  ctx.fillStyle = rgba(accent, 0.5);
  ctx.lineWidth = 1.2;
  const scale = step / 260;
  for (let y = -step * 0.4, row = 0; y < h + step; y += step, row++) {
    for (let x = row % 2 === 0 ? -step * 0.4 : step * 0.1; x < w + step; x += step) {
      drawEmblem(ctx, emblem, x, y, scale);
    }
  }
  ctx.restore();
}

/** Ingredient 4 — a floor pool and a vignette, so the light has somewhere to land. */
function room(ctx: CanvasRenderingContext2D, w: number, h: number, accent: string): void {
  ctx.save();
  const pool = ctx.createRadialGradient(w * 0.34, h * 1.02, 0, w * 0.34, h * 1.02, Math.max(w, h) * 0.7);
  pool.addColorStop(0, rgba(accent, 0.24));
  pool.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  const vignette = ctx.createRadialGradient(w * 0.42, h * 0.4, Math.min(w, h) * 0.18, w * 0.5, h * 0.5, Math.hypot(w, h) * 0.62);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.62)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Ingredient 5 — module B's grain, not a second one.
 *
 * `noiseTexture` is the same generator `--tex-grain` is cut from, and its
 * backing canvas is reachable synchronously, which the `data:` URI form is not.
 * One tile, memoised inside module B, tiled across whatever this is painting.
 */
let grainTile: CanvasImageSource | null | undefined;

/**
 * Grain, and the size below which it is not worth having.
 *
 * §1 asks for texture at 2–6% so a surface is not mathematically smooth. On a
 * 1024px banner that is the difference between a room and a gradient. On a 60px
 * rank crest sitting inside a `.mat-panel` that already carries its own grain,
 * it is four hundred pixels of noise nobody can resolve — and it costs a
 * `createPattern` plus a full-surface fill *per piece*, twenty-three times, on
 * the frame the mastery grid mounts. The tile it sits on supplies the texture at
 * that scale; this supplies it where it reads.
 */
const GRAIN_FLOOR = 150;

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, amount = 1): void {
  if (Math.max(w, h) < GRAIN_FLOOR) return;
  if (grainTile === undefined) {
    const image = noiseTexture({ size: 128, amount: 0.05, clump: 0.6 }).image as CanvasImageSource | undefined;
    grainTile = image ?? null;
  }
  if (!grainTile) return;
  const fill = ctx.createPattern(grainTile, "repeat");
  if (!fill) return;
  ctx.save();
  ctx.globalAlpha = amount;
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/**
 * The edge treatment every raised object in the game wears, in canvas form.
 *
 * Lit hairline along the top and left, black lip along the bottom and right —
 * the same two lines `foundation.css` puts on `.mat-panel`, drawn here because a
 * `background-image` sits *inside* the host's border and would otherwise have a
 * visible seam where the painting stops and the CSS material starts.
 */
function bevel(ctx: CanvasRenderingContext2D, w: number, h: number, radius: number): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.beginPath();
  ctx.moveTo(0.5, h - radius);
  ctx.lineTo(0.5, radius);
  ctx.quadraticCurveTo(0.5, 0.5, radius, 0.5);
  ctx.lineTo(w - radius, 0.5);
  ctx.stroke();
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.moveTo(w - 0.5, radius);
  ctx.lineTo(w - 0.5, h - radius);
  ctx.quadraticCurveTo(w - 0.5, h - 0.5, w - radius, h - 0.5);
  ctx.lineTo(radius, h - 0.5);
  ctx.stroke();
  ctx.restore();
}

function roundedPath(ctx: CanvasRenderingContext2D, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w - r, 0);
  ctx.quadraticCurveTo(w, 0, w, r);
  ctx.lineTo(w, h - r);
  ctx.quadraticCurveTo(w, h, w - r, h);
  ctx.lineTo(r, h);
  ctx.quadraticCurveTo(0, h, 0, h - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Emblems
// ---------------------------------------------------------------------------

/**
 * The mark a faction already owns.
 *
 * `data/cosmetics.json` has mapped all ten for as long as card backs have
 * existed — Neon Idols a starburst, Gothic Royalty a rose, the Algorithm
 * Syndicate an eye — and the Mastery grid rendered ten identical grey tiles
 * anyway. Read from the same table the card backs read, so a faction cannot end
 * up wearing two different crests two screens apart.
 *
 * Wrapped in a try because `cosmeticsData()` validates on first call and throws
 * on a malformed file. A crest is decoration; a decoration must never be the
 * thing that takes a screen down, and the house diamond is a perfectly good
 * answer for a faction the table has not heard of.
 */
const FALLBACK_EMBLEM: EmblemShape = "diamond";

let emblemTable: Record<string, EmblemShape> | null = null;

export function emblemFor(factionId: string): EmblemShape {
  if (!emblemTable) {
    try {
      emblemTable = cosmeticsData().emblems as Record<string, EmblemShape>;
    } catch {
      emblemTable = {};
    }
  }
  return emblemTable[factionId] ?? FALLBACK_EMBLEM;
}

export function colourFor(factionId: string): string {
  return FACTION_COLOR[factionId as FactionId] ?? FACTION_COLOR.neutral;
}

// ---------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------

export interface CrestOptions {
  /** Device pixels across. 96 is the mastery tile, 168 the profile avatar ring. */
  size?: number;
  /** Override the faction colour — the rank crest tints by tier, not by faction. */
  colour?: string;
  /** 0 draws an unearned, unlit crest; 1 is fully lit. */
  lit?: number;
}

/**
 * A faction crest as a struck medallion.
 *
 * Hexagonal rather than round, because a circle beside the round avatar and the
 * round currency chips is a third circle and the eye stops sorting them. The
 * plate is bevelled on the light side, cut on the dark side, and the emblem is
 * struck *into* it — drawn once in black offset down-right and once in the
 * faction colour on the light side, which is how a stamped metal mark actually
 * catches a lamp.
 */
export function crest(factionId: string, options: CrestOptions = {}): string {
  const size = options.size ?? 96;
  const colour = options.colour ?? colourFor(factionId);
  const lit = options.lit ?? 1;
  return cached(`crest|${factionId}|${size}|${colour}|${lit.toFixed(2)}`, () => {
    const target = surface(size, size);
    if (!target) return "";
    const { canvas, ctx } = target;
    const c = size / 2;
    const r = size * 0.46;

    // the hexagon
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const x = c + Math.cos(angle) * r;
      const y = c + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.save();
    ctx.clip();

    const [x0, y0, x1, y1] = keyVector(size, size);
    const face = ctx.createLinearGradient(x0, y0, x1, y1);
    face.addColorStop(0, shade(colour, 0.5 + (1 - lit) * 0.35));
    face.addColorStop(0.62, shade(colour, 0.8 + (1 - lit) * 0.15));
    face.addColorStop(1, "#08050f");
    ctx.fillStyle = face;
    ctx.fillRect(0, 0, size, size);

    shaft(ctx, size, size, colour, 0.7 * lit);

    // the mark, struck: shadow first, then the lit face of the cut
    ctx.lineWidth = Math.max(1.2, size * 0.019);
    ctx.strokeStyle = `rgba(0,0,0,${0.55 * (0.4 + lit * 0.6)})`;
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    drawEmblem(ctx, emblemFor(factionId), c + size * 0.012, c + size * 0.012, size / 300);
    ctx.strokeStyle = rgba(colour, 0.24 + 0.7 * lit);
    ctx.fillStyle = rgba(colour, 0.14 * lit);
    drawEmblem(ctx, emblemFor(factionId), c, c, size / 300);

    grain(ctx, size, size, 0.9);
    ctx.restore();

    // the rim: lit on the top-left arc, cut on the bottom-right one
    ctx.lineWidth = Math.max(1, size * 0.022);
    for (const [from, to, ink] of [
      [3, 6, `rgba(255,255,255,${0.3 * (0.35 + lit * 0.65)})`],
      [0, 3, "rgba(0,0,0,0.6)"],
    ] as const) {
      ctx.beginPath();
      for (let i = from; i <= to; i++) {
        const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
        const x = c + Math.cos(angle) * (r - ctx.lineWidth / 2);
        const y = c + Math.sin(angle) * (r - ctx.lineWidth / 2);
        if (i === from) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = ink;
      ctx.stroke();
    }

    return canvas.toDataURL("image/png");
  });
}

/**
 * An event currency, as a struck token rather than a code point.
 *
 * `data/events.json` authors each event currency's mark as a Unicode character:
 * `◈` for Con Badges, `✸` for Pixel Pumpkins and `❘` for Glowsticks — which is
 * a **vertical bar**, so the second event's money rendered on screen as a thin
 * line in whatever face the OS happened to have. Module C's whole argument
 * applies: a glyph used as an icon comes out at the wrong weight, at the wrong
 * optical size, and becomes tofu wherever the code point is missing.
 *
 * So the mark is drawn instead, from the event's own emblem shape and its own
 * accent, on the same struck-metal logic as `crest` — a round coin rather than a
 * hexagon, because a currency in this game is already round on the Clout and
 * Signal chips and the eye should sort it into that family rather than into the
 * faction family.
 *
 * One canonical size, scaled by CSS at the call site, for the same reason
 * `crestMark` gives: the events hub asks for this mark at 15px, 18px and 34px,
 * and keying the cache by display size would draw it three times.
 */
export function token(emblem: EmblemShape, accent: string, size = 96): string {
  return cached(`token|${emblem}|${accent}|${size}`, () => {
    const target = surface(size, size);
    if (!target) return "";
    const { canvas, ctx } = target;
    const c = size / 2;
    const r = size * 0.44;

    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.save();
    ctx.clip();

    /*
     * A coin is a *light* object, and that is not how the first version read.
     *
     * Keyed off the crest's numbers, this came out as a near-black disc with a
     * hairline mark on it: at the 16px the balance line asks for, an emblem
     * stroked at `size * 0.024` of a 96px drawing is a third of a pixel and the
     * whole token was a dark dot. So the face keeps far more of the accent than
     * the hexagonal crest does — a crest is struck steel in shadow, a coin is
     * catching the light — and the mark is cut four times as deep. Both numbers
     * are for legibility at the smallest call site, which is the one that decides
     * whether this is an icon or a smudge.
     */
    const [x0, y0, x1, y1] = keyVector(size, size);
    const face = ctx.createLinearGradient(x0, y0, x1, y1);
    face.addColorStop(0, shade(accent, 0.06));
    face.addColorStop(0.58, shade(accent, 0.42));
    face.addColorStop(1, shade(accent, 0.82));
    ctx.fillStyle = face;
    ctx.fillRect(0, 0, size, size);
    shaft(ctx, size, size, accent, 0.4);

    // struck: the shadow of the cut down-right, the lit face of it on top
    ctx.lineWidth = Math.max(1.6, size * 0.075);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.fillStyle = "rgba(0,0,0,0.26)";
    drawEmblem(ctx, emblem, c + size * 0.02, c + size * 0.02, size / 340);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    drawEmblem(ctx, emblem, c, c, size / 340);

    grain(ctx, size, size, 0.9);
    ctx.restore();

    // the rim, lit at 315° and cut at 135° like every other object in the game
    ctx.lineWidth = Math.max(1, size * 0.05);
    for (const [from, to, ink] of [
      [Math.PI, Math.PI * 2, "rgba(255,255,255,0.42)"],
      [0, Math.PI, "rgba(0,0,0,0.55)"],
    ] as const) {
      ctx.beginPath();
      ctx.arc(c, c, r - ctx.lineWidth / 2, from - Math.PI / 4, to - Math.PI / 4);
      ctx.strokeStyle = ink;
      ctx.stroke();
    }

    return canvas.toDataURL("image/png");
  });
}

export interface BannerOptions {
  width?: number;
  height?: number;
  /** Anything stable — an event id, an article id — so two banners differ. */
  seed?: string;
  /** Which faction's mark tiles the surface. */
  emblem?: EmblemShape;
  radius?: number;
  /** How hard the emblem pattern reads. 0.06 is the house value. */
  patternAlpha?: number;
}

/**
 * Key art: the thing an event tile, a news hero and a designed empty state all
 * needed and none of them had.
 *
 * MTG Arena's event tiles are painted 16:9 plates with a diagonal foil sweep;
 * Hearthstone illustrates its event pages. This is the honest procedural answer
 * to the same brief — a lit room in the event's own colour with its mark on the
 * walls — and it is a picture, which an 84×200 radial gradient was not.
 *
 * The seed moves the light and the pattern phase, so the three events on the hub
 * are three different rooms rather than the same one recoloured.
 */
export function banner(accent: string, options: BannerOptions = {}): string {
  const w = options.width ?? 640;
  const h = options.height ?? 360;
  const seed = options.seed ?? "";
  const emblem = options.emblem ?? FALLBACK_EMBLEM;
  const radius = options.radius ?? 0;
  const patternAlpha = options.patternAlpha ?? 0.06;

  return cached(`banner|${accent}|${w}|${h}|${seed}|${emblem}|${radius}|${patternAlpha}`, () => {
    const target = surface(w, h);
    if (!target) return "";
    const { canvas, ctx } = target;

    if (radius > 0) {
      roundedPath(ctx, w, h, radius);
      ctx.save();
      ctx.clip();
    }

    base(ctx, w, h, accent);
    shaft(ctx, w, h, accent, 1);

    /*
     * A phase offset from the seed, so no two banners tile in step.
     *
     * `>>>`, not `>>`, and it is not a nicety. `hash` is coerced unsigned, so it
     * routinely exceeds 2^31 — and `>>` is the *signed* shift, which hands back a
     * negative number for exactly those values. `% 40` of a negative is negative,
     * which put the specular stop at −0.09 and made `addColorStop` throw: the
     * news screen died on its first article and rendered the error page instead.
     * A seeded value that only breaks for half its inputs is the worst kind, and
     * the clamp below is the belt for that particular braces.
     */
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    const step = Math.max(64, Math.round(Math.min(w, h) * 0.42));
    ctx.save();
    ctx.translate(-(hash % step), -((hash >>> 8) % step));
    pattern(ctx, w + step * 2, h + step * 2, emblem, accent, step, patternAlpha);
    ctx.restore();

    // one hard streak of light along the key axis — the foil sweep
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const streakAt = Math.min(0.9, Math.max(0.12, 0.24 + ((hash >>> 4) % 40) / 100));
    const [sx0, sy0, sx1, sy1] = keyVector(w, h);
    const streak = ctx.createLinearGradient(sx0, sy0, sx1, sy1);
    streak.addColorStop(Math.max(0, streakAt - 0.1), "rgba(255,255,255,0)");
    streak.addColorStop(streakAt, "rgba(255,255,255,0.09)");
    streak.addColorStop(Math.min(1, streakAt + 0.1), "rgba(255,255,255,0)");
    ctx.fillStyle = streak;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    room(ctx, w, h, accent);
    grain(ctx, w, h, 0.85);
    if (radius > 0) {
      ctx.restore();
      ctx.save();
      roundedPath(ctx, w, h, radius);
      ctx.clip();
      bevel(ctx, w, h, radius);
      ctx.restore();
    } else {
      bevel(ctx, w, h, 0);
    }

    return canvas.toDataURL("image/png");
  });
}

export type RewardKind = "clout" | "fragments" | "pack" | "pick" | "lore" | "cosmetic" | "locked";

/**
 * A reward, drawn as the object it is.
 *
 * Twenty rows of the word "Locked" beside twenty identical grey pills is the
 * emotional engine of progression rendered as a spreadsheet. MTGA draws each
 * node's actual reward; Hearthstone shows chests you can see. These are small —
 * 64px — but they are six different *shapes*, so a Faction Pack and a lore page
 * are told apart before any text is read, which also satisfies §9's
 * "nothing is signalled by colour alone".
 */
export function rewardTile(kind: RewardKind, colour: string, size = 64): string {
  return cached(`reward|${kind}|${colour}|${size}`, () => {
    const target = surface(size, size);
    if (!target) return "";
    const { canvas, ctx } = target;
    const s = (v: number): number => v * (size / 64);
    const dim = kind === "locked";
    const ink = dim ? "#6a6382" : colour;

    roundedPath(ctx, size, size, s(12));
    ctx.save();
    ctx.clip();
    const [x0, y0, x1, y1] = keyVector(size, size);
    const face = ctx.createLinearGradient(x0, y0, x1, y1);
    face.addColorStop(0, shade(ink, dim ? 0.72 : 0.56));
    face.addColorStop(1, "#07040e");
    ctx.fillStyle = face;
    ctx.fillRect(0, 0, size, size);
    shaft(ctx, size, size, ink, dim ? 0.3 : 0.85);

    ctx.lineWidth = s(2);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = rgba(ink, dim ? 0.5 : 0.95);
    ctx.fillStyle = rgba(ink, dim ? 0.12 : 0.22);

    const cx = size / 2;
    const cy = size / 2;

    switch (kind) {
      case "clout": {
        // the currency, as a struck coin with the house diamond on it
        ctx.beginPath();
        ctx.arc(cx, cy, s(17), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx, cy - s(9));
        ctx.lineTo(cx + s(9), cy);
        ctx.lineTo(cx, cy + s(9));
        ctx.lineTo(cx - s(9), cy);
        ctx.closePath();
        ctx.stroke();
        break;
      }
      case "fragments": {
        // Signal: three shards, one bright
        for (const [dx, dy, scale, alpha] of [
          [-9, 4, 1, 0.55],
          [8, 7, 0.8, 0.45],
          [1, -7, 1.25, 1],
        ] as const) {
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.moveTo(cx + s(dx), cy + s(dy - 9 * scale));
          ctx.lineTo(cx + s(dx + 6 * scale), cy + s(dy));
          ctx.lineTo(cx + s(dx), cy + s(dy + 9 * scale));
          ctx.lineTo(cx + s(dx - 6 * scale), cy + s(dy));
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case "pack": {
        // a real stack with thickness, which is what a pack is
        for (let i = 2; i >= 0; i--) {
          ctx.globalAlpha = i === 0 ? 1 : 0.42;
          const off = s(i * 3.4);
          ctx.beginPath();
          const x = cx - s(13) + off;
          const y = cy - s(18) + off;
          ctx.rect(x, y, s(23), s(31));
          ctx.fill();
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.moveTo(cx - s(13), cy - s(4));
        ctx.lineTo(cx + s(10), cy - s(4));
        ctx.stroke();
        break;
      }
      case "pick": {
        // a fan of three, one of them chosen
        for (const angle of [-0.38, 0, 0.38]) {
          ctx.save();
          ctx.translate(cx, cy + s(8));
          ctx.rotate(angle);
          ctx.globalAlpha = angle === 0 ? 1 : 0.4;
          ctx.beginPath();
          ctx.rect(-s(8), -s(26), s(16), s(26));
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case "lore": {
        // an open page, with lines on it
        ctx.beginPath();
        ctx.moveTo(cx - s(19), cy - s(13));
        ctx.quadraticCurveTo(cx, cy - s(7), cx + s(19), cy - s(13));
        ctx.lineTo(cx + s(19), cy + s(15));
        ctx.quadraticCurveTo(cx, cy + s(21), cx - s(19), cy + s(15));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 0.55;
        for (let i = 0; i < 3; i++) {
          const y = cy - s(4) + s(i * 6);
          ctx.beginPath();
          ctx.moveTo(cx - s(13), y);
          ctx.lineTo(cx - s(3), y);
          ctx.moveTo(cx + s(3), y);
          ctx.lineTo(cx + s(13), y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case "cosmetic": {
        // a hung garment plate — a thing you wear, not a thing you spend
        ctx.beginPath();
        ctx.moveTo(cx, cy - s(19));
        ctx.lineTo(cx + s(17), cy - s(2));
        ctx.lineTo(cx + s(11), cy + s(18));
        ctx.lineTo(cx - s(11), cy + s(18));
        ctx.lineTo(cx - s(17), cy - s(2));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.arc(cx, cy + s(2), s(6), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }
      case "locked": {
        // the padlock from the icon set's geometry, drawn at plate scale
        ctx.beginPath();
        ctx.rect(cx - s(13), cy - s(3), s(26), s(19));
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy - s(4), s(8), Math.PI, 0);
        ctx.stroke();
        break;
      }
    }

    grain(ctx, size, size, 0.8);
    bevel(ctx, size, size, s(12));
    ctx.restore();
    return canvas.toDataURL("image/png");
  });
}

/**
 * The rank object: a plate with a tier gem in it.
 *
 * "A rank crest is the most-screenshotted object in a competitive card game and
 * this build does not have one" — recon defect 12. It goes on the profile, on
 * Leaderboards as the player's honest local standing, on every Mastery tile and
 * in the match-history detail header, so that one object is what the domain is
 * recognised by.
 *
 * The tier ladder is carried by **three** channels, not by hue: the metal gets
 * lighter, the number of pips cut into the rim goes up, and the gem changes
 * shape. That is what makes it legible in a greyscale screenshot and to a
 * player who cannot separate amber from green.
 */
export interface RankCrestOptions {
  size?: number;
  /** 0 for unranked/unplaced — draws the empty socket rather than a gem. */
  tier?: number;
  tiers?: number;
  colour?: string;
}

export function rankCrest(options: RankCrestOptions = {}): string {
  const size = options.size ?? 128;
  const tier = Math.max(0, options.tier ?? 0);
  const tiers = Math.max(1, options.tiers ?? 20);
  const colour = options.colour ?? "#b56cff";

  return cached(`rank|${size}|${tier}|${tiers}|${colour}`, () => {
    const target = surface(size, size);
    if (!target) return "";
    const { canvas, ctx } = target;
    const s = (v: number): number => v * (size / 128);
    const cx = size / 2;
    const cy = size / 2;
    const progress = tier / tiers;
    // the metal climbs; it never changes hue, so the ladder survives greyscale
    const metal = tier === 0 ? "#5b5470" : shade(colour, 0.42 - progress * 0.3);

    // shield silhouette
    const shield = (inset: number): void => {
      const w = s(44) - inset;
      const top = cy - s(48) + inset;
      const shoulder = cy + s(6);
      const point = cy + s(50) - inset;
      ctx.beginPath();
      ctx.moveTo(cx - w, top + s(8));
      ctx.quadraticCurveTo(cx - w, top, cx - w + s(8), top);
      ctx.lineTo(cx + w - s(8), top);
      ctx.quadraticCurveTo(cx + w, top, cx + w, top + s(8));
      ctx.lineTo(cx + w, shoulder);
      ctx.quadraticCurveTo(cx + w, point - s(14), cx, point);
      ctx.quadraticCurveTo(cx - w, point - s(14), cx - w, shoulder);
      ctx.closePath();
    };

    ctx.save();
    shield(0);
    ctx.clip();
    const [x0, y0, x1, y1] = keyVector(size, size);
    const face = ctx.createLinearGradient(x0, y0, x1, y1);
    face.addColorStop(0, metal);
    face.addColorStop(0.55, shade(metal, 0.55));
    face.addColorStop(1, "#08050f");
    ctx.fillStyle = face;
    ctx.fillRect(0, 0, size, size);
    shaft(ctx, size, size, tier === 0 ? "#8f8aa8" : colour, tier === 0 ? 0.35 : 0.9);

    /*
     * The gem sits in the shield's upper band, not at its centre.
     *
     * The centre belongs to the number — this crest is read at 76–96px on a row
     * of other things, and the rank is what a player is looking for. The first
     * version put a 15px gem dead centre and the tabular figure landed on top of
     * both it and the pips, which is three objects fighting over one 30px band.
     */
    const gemY = cy - s(26);
    const gemR = s(10);
    ctx.lineWidth = s(2.2);
    if (tier === 0) {
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.fillStyle = "rgba(0,0,0,0.42)";
      ctx.beginPath();
      ctx.arc(cx, gemY, gemR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      // facets: three at the bottom of the ladder, six at the top
      const facets = 3 + Math.min(3, Math.floor(progress * 3.999));
      const gem = ctx.createRadialGradient(cx - gemR * 0.4, gemY - gemR * 0.4, 0, cx, gemY, gemR * 1.3);
      gem.addColorStop(0, "rgba(255,255,255,0.92)");
      gem.addColorStop(0.35, rgba(colour, 0.95));
      gem.addColorStop(1, shade(colour, 0.65));
      ctx.fillStyle = gem;
      ctx.beginPath();
      for (let i = 0; i < facets; i++) {
        const angle = (i / facets) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(angle) * gemR;
        const y = gemY + Math.sin(angle) * gemR;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.stroke();
    }

    grain(ctx, size, size, 0.9);
    ctx.restore();

    // rim: lit on the light side, cut on the other
    ctx.lineWidth = s(3);
    ctx.save();
    shield(s(1.5));
    ctx.strokeStyle = tier === 0 ? "rgba(255,255,255,0.16)" : rgba(colour, 0.55);
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, size * 0.62, size * 0.62);
    ctx.clip();
    shield(s(1.5));
    ctx.lineWidth = s(2.4);
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.stroke();
    ctx.restore();

    // pips along the base: the third channel the ladder is carried on
    if (tier > 0) {
      const pips = Math.min(5, Math.max(1, Math.ceil(progress * 5)));
      ctx.fillStyle = rgba(colour, 0.95);
      for (let i = 0; i < pips; i++) {
        const x = cx + (i - (pips - 1) / 2) * s(10);
        ctx.beginPath();
        ctx.arc(x, cy + s(30), s(2.8), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    return canvas.toDataURL("image/png");
  });
}

/**
 * The silhouette ladder behind the Leaderboards explainer.
 *
 * Gwent offline still shows the ladder art behind a "server unavailable" plate.
 * This is that: carved empty rows receding into the dark, with nothing written
 * on any of them, so the screen is composed and still tells the truth.
 */
export function ladderPlate(width = 960, height = 320, accent = "#b56cff"): string {
  return cached(`ladder|${width}|${height}|${accent}`, () => {
    const target = surface(width, height);
    if (!target) return "";
    const { canvas, ctx } = target;
    base(ctx, width, height, accent);
    shaft(ctx, width, height, accent, 0.55);

    /*
     * Nine carved rows, receding.
     *
     * Each is inset a little further and drawn a little shorter than the one
     * above, so the ladder has perspective rather than being nine equal bars —
     * and each carries the same two-line edge every raised object in the game
     * wears, lit on the top, cut on the bottom. Nothing is written on any of
     * them, which is the whole point.
     */
    const rows = 9;
    for (let i = 0; i < rows; i++) {
      const t = i / rows;
      const h = height * 0.082 * (1 - t * 0.4);
      const y = height * 0.05 + i * (height * 0.104);
      const inset = width * (0.05 + t * 0.16);
      const fade = 1 - t * 0.72;
      roundedPath2(ctx, inset, y, width - inset * 2, h, h * 0.3);
      ctx.fillStyle = `rgba(0,0,0,${0.58 * fade})`;
      ctx.fill();
      // the lit lip of the carve, on the top edge, and its shadow on the bottom
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(255,255,255,${0.16 * fade})`;
      ctx.beginPath();
      ctx.moveTo(inset + h * 0.34, y + 0.5);
      ctx.lineTo(width - inset - h * 0.34, y + 0.5);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${0.05 * fade})`;
      ctx.beginPath();
      ctx.moveTo(inset + h * 0.34, y + h - 0.5);
      ctx.lineTo(width - inset - h * 0.34, y + h - 0.5);
      ctx.stroke();
      // the empty plate at the head of each row, where a portrait would go
      ctx.fillStyle = `rgba(255,255,255,${0.05 * fade})`;
      roundedPath2(ctx, inset + h * 0.28, y + h * 0.2, h * 0.6, h * 0.6, h * 0.18);
      ctx.fill();
    }

    room(ctx, width, height, accent);
    grain(ctx, width, height, 0.7);
    return canvas.toDataURL("image/png");
  });
}

function roundedPath2(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
