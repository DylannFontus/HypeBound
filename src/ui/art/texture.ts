/**
 * The surface layer: grain, soft masks, bevels, contact shadows and the light
 * that all three of them agree about.
 *
 * HYPEBOUND draws its interface twice. The HUD, the lobby and forty-nine other
 * screens are DOM and CSS; the board, the cards on it and the mat under them are
 * three.js. Both halves are on screen at the same time, often within a few
 * pixels of each other — the hand tucks under the mat's lower edge, the card
 * detail panel sits over the board — and the eye reads them as one object or as
 * two depending entirely on whether their surfaces match.
 *
 * "Looks about the same" is not a match. A CSS `radial-gradient` noise hack and
 * a three.js `NoiseTexture` are two different grains, and side by side they
 * announce that the interface was assembled rather than designed. So every
 * function here that is meaningful in both worlds returns **both** forms, and
 * they come from literally the same canvas: `grainDataUri` and `noiseTexture`
 * with the same arguments hand out one bitmap, encoded for CSS in one case and
 * uploaded to the GPU in the other. There is no second implementation to drift.
 *
 * ## Everything is generated, nothing is fetched
 *
 * The privacy screen promises this build downloads nothing, and that promise
 * covers textures as firmly as it covers fonts. Every pixel in this file is
 * computed from a seeded PRNG at boot or on first use. That also means the
 * results are *reproducible*: the same seed gives the same grain on every
 * machine and in every session, so a screenshot taken today can be diffed
 * against one taken next month and the difference is the change you made.
 *
 * ## The light comes from the top-left, and this is where that is written down
 *
 * `LIGHT_RIG` is the one global constant of the visual system — 315° in CSS
 * terms, a normalised world vector for three.js, and the key/fill/rim
 * intensities that go with it. Two adjacent panels lit from different directions
 * is the defect that reads as amateur before a viewer can name it, and with
 * fifteen builders working in parallel the only defence is a constant that
 * everybody imports instead of a convention everybody remembers.
 * `tests/texture-light-rig.test.ts` proves the CSS angle and the world vector
 * describe the same direction, so the two representations cannot drift apart.
 *
 * ## Memoisation, and the one place it is deliberately absent
 *
 * These are called from render loops by callers who have no idea a canvas is
 * involved, so everything is cached by argument key and the second call costs a
 * map lookup. The cache is an LRU with a cap, because a caller passing a size
 * that changes every frame would otherwise allocate a bitmap a frame forever.
 *
 * Eviction drops our reference but does **not** dispose the texture, because we
 * cannot know whether a material is still rendering with it — disposing a live
 * texture turns a memory optimisation into a black rectangle mid-match. If you
 * build textures with genuinely unbounded parameters you own their disposal.
 *
 * `rimGradient` is the exception that is not memoised: a `CanvasGradient`
 * belongs to the context that created it, caching it by rectangle would leak an
 * entry per unique size, and constructing one is a dozen floating-point
 * operations. Caching it would cost more than the work.
 *
 * ## This module is imported by code that runs under node
 *
 * The test environment is `node`, with no `document` and no canvas. Every entry
 * point here therefore survives their absence: the data-URI functions return an
 * empty string, the texture functions return a well-formed but blank
 * `CanvasTexture`, and `installTextureVars` does nothing at all. Callers get a
 * value of the right type rather than a crash, which is what lets a screen
 * module be unit-tested without a headless browser.
 */

import * as THREE from "three";
import type { CurrentId } from "../../engine/types";
import { CURRENT_PALETTE, hexToRgba, mix } from "../cardRenderer/palette";
import { getAsset } from "./assetLoader";
import { createStyleElement } from "../styleSheet";

// ---------------------------------------------------------------------------
// 0. The light rig
// ---------------------------------------------------------------------------

/**
 * CSS gradient angles: 0° points to the top of the screen and they run
 * clockwise, so 315° points at the top-left corner. The vector below is the
 * direction *toward* the light, which is why a shadow offset is its negation.
 */
const CSS_ANGLE = 315;

/**
 * The key light's elevation above the board plane, in degrees.
 *
 * 45° is not an arbitrary round number here: it makes the horizontal and
 * vertical components of the world vector equal, which is what lets the world
 * vector and the CSS angle be checked against each other exactly rather than
 * approximately. It is also the elevation that gives a rim highlight on the top
 * edge and a readable contact shadow on the ground at the same time — lower and
 * the shadows stretch into smears, higher and the top rim goes flat.
 */
const ELEVATION = 45;

/**
 * A CSS gradient angle to a normalised three.js direction.
 *
 * The board is the XZ plane with +Y up, framed by a camera looking down the
 * -Z axis, so screen-right is world +X and screen-up is world -Z. Elevation
 * lifts the vector out of the plane. Exported because the conversion is the
 * thing the test checks — a test that reimplemented it would prove only that
 * two copies of the same arithmetic agree.
 */
export function cssAngleToWorld(cssAngle: number, elevation: number = ELEVATION): THREE.Vector3 {
  const azimuth = (cssAngle * Math.PI) / 180;
  const lift = (elevation * Math.PI) / 180;
  const ground = Math.cos(lift);
  return new THREE.Vector3(
    Math.sin(azimuth) * ground, // screen x
    Math.sin(lift), // up
    -Math.cos(azimuth) * ground // screen y, up the screen is toward -z
  ).normalize();
}

/** The inverse: which CSS angle does this world direction light a screen from? */
export function worldToCssAngle(world: THREE.Vector3): number {
  const degrees = (Math.atan2(world.x, -world.z) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

/**
 * Where the light is, how bright it is, and the two ways of saying so.
 *
 * `key`, `fill` and `rim` are three.js light intensities in a 3:1 key-to-fill
 * ratio — dramatic enough for a nightlife setting, shallow enough that an unlit
 * face is still readable, which matters when the unlit face has a card's rules
 * text on it. `key` is deliberately the value the battle scene already uses for
 * its directional light, so adopting the rig changes the *direction* of the
 * light in that scene without also changing its exposure.
 *
 * `world` is shared and must be treated as read-only. Three.js code that wants
 * a position rather than a direction should call `lightPosition`, which returns
 * a fresh vector every time.
 */
export const LIGHT_RIG = Object.freeze({
  /** Degrees, CSS convention: 0 is up, clockwise. Module A mirrors this as `--light-angle`. */
  cssAngle: CSS_ANGLE as 315,
  /** Normalised three.js direction pointing from the board toward the light. */
  world: cssAngleToWorld(CSS_ANGLE),
  /** Screen-space unit vector toward the light, in CSS coordinates (y grows downward). */
  screen: Object.freeze({
    x: Math.sin((CSS_ANGLE * Math.PI) / 180),
    y: -Math.cos((CSS_ANGLE * Math.PI) / 180),
  }),
  /** Degrees above the board plane. */
  elevation: ELEVATION,
  key: 1.9,
  fill: 0.63,
  rim: 1.35,
});

/** A fresh world position for a directional light `distance` units out along the rig. */
export function lightPosition(distance = 18): THREE.Vector3 {
  return LIGHT_RIG.world.clone().multiplyScalar(distance);
}

/**
 * Where a shadow falls, in CSS pixels, for an object `distance` above its
 * backing.
 *
 * The horizontal throw is deliberately shorter than the vertical one even
 * though the light is at 45° in plane. A UI panel sits a millimetre above its
 * backing, not a metre; the part of the offset the eye reads as "floating" is
 * the vertical component, and a full 45° cast on a panel reads as a sticker
 * peeled off the screen. 0.62 keeps the direction unmistakably top-left-lit
 * while keeping the panel attached to the page.
 *
 * `foundation.css` §3 mirrors this ratio into the DOM cast — the `6.2px` beside
 * every `10px` and the `1.24px` beside every `2px` in `--mat-cast`. It did not,
 * for one round: both shadow layers were `0 Npx`, so every raised object on the
 * page shadowed as if the key light were directly overhead, and the gallery
 * printed `shadowOffset(10) → x 4.4, y 7.1` in its light readout and then
 * contradicted it on every plate below. `tests/texture-light-rig.test.ts` now
 * reads the ratio back out of the stylesheet, because that is the sort of thing
 * that only stays fixed if something is checking.
 */
export const SHADOW_THROW_RATIO = 0.62;

export function shadowOffset(distance: number): { x: number; y: number } {
  return {
    x: -LIGHT_RIG.screen.x * distance * SHADOW_THROW_RATIO,
    y: -LIGHT_RIG.screen.y * distance,
  };
}

// ---------------------------------------------------------------------------
// 1. Material ranks
// ---------------------------------------------------------------------------

/** The four materials of contract §A1. Every surface in the game is one of these. */
export type MaterialTier = "hero" | "panel" | "chip" | "well";

/**
 * One amplitude scale across all four, so a hero button and a currency chip are
 * recognisably the same material at different ranks rather than two unrelated
 * treatments. These are the contract's numbers; module A applies them in CSS and
 * this module applies them to canvas and three.js, from this one declaration.
 */
export const MATERIAL_AMPLITUDE: Readonly<Record<MaterialTier, number>> = Object.freeze({
  hero: 1,
  panel: 0.55,
  chip: 0.35,
  well: 0.7,
});

/** Accepts a tier name or a raw amplitude, because callers have both. */
export function amplitudeOf(tier: MaterialTier | number = "panel"): number {
  return typeof tier === "number" ? clamp(tier, 0, 2) : MATERIAL_AMPLITUDE[tier];
}

/**
 * How light each material's face actually renders, 0–255, measured off the
 * gallery's A1 comparison row at 1× rather than derived from the gradient stops.
 *
 * This exists because the four materials are a *value structure* — hero far
 * lighter than chip, chip above panel, panel above well — and every decoration
 * laid on top of them (grain, the specular crawl, a rim) is a delta against that
 * value. A decoration specified as one alpha for all four is therefore four
 * different decorations, and the darker the plate the louder it lands: white at
 * alpha a lifts a face of luma F by a·(255 − F), which is 92a on the hero and
 * 242a on the well. That is a 2.6× spread before anybody has made a decision.
 *
 * So these numbers are the denominator. `--rim-a` and `--lip-a` in module A §3
 * were already tuned against them by hand; `grainContrast` below does the same
 * arithmetic for the grain so the four tiles can be *derived* rather than
 * guessed, and `tests/texture-light-rig.test.ts` asserts the four land within
 * 1.5× of each other.
 */
export const MATERIAL_FACE: Readonly<Record<MaterialTier, number>> = Object.freeze({
  hero: 148,
  panel: 31,
  chip: 48,
  well: 13,
});

/**
 * The empirical constant tying a grain's *peak* alpha to the high-pass standard
 * deviation it actually produces on a plate.
 *
 * The RMS swing of a symmetric signed grain over a face F is
 * sqrt((255−F)²/2 + F²/2). Dividing the measured SD of each rendered plate by
 * `amount · swing(face)` gives 0.333 on the hero, 0.316 on the panel and 0.315
 * on the chip, and 0.32 splits them. The residual scatter is the ^1.25 shaping
 * in `grainCanvas` and the particular high-pass kernel used — this is a
 * calibration, not a derivation, and it is good to about ±10%, which is an order
 * of magnitude tighter than the defect it exists to prevent.
 */
const GRAIN_GAIN = 0.32;

/**
 * The rendered contrast of a grain of peak alpha `amount` over a face of luma
 * `face`, expressed as a fraction of that face — which is the only form in which
 * "the four materials are one substance" is a checkable statement.
 *
 * §1 of the AAA bar asks for texture at "2–6% opacity"; read against the face
 * rather than against nothing, that is this number, and 4% is the middle of it.
 */
export function grainContrast(amount: number, face: number): number {
  const swing = Math.sqrt(0.5 * (255 - face) ** 2 + 0.5 * face ** 2);
  return (GRAIN_GAIN * amount * swing) / face;
}

// ---------------------------------------------------------------------------
// 2. Small maths, used everywhere below
// ---------------------------------------------------------------------------

const clamp = (value: number, low: number, high: number): number =>
  value < low ? low : value > high ? high : value;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Hermite. Used where a value only needs to be continuous. */
const smoothstep = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/**
 * Second-order Hermite, continuous in its first *and* second derivative.
 *
 * The difference matters exactly once, and this module is where it happens: a
 * `smoothstep` alpha ramp has a visible kink at both ends, and on a large soft
 * mask — the battle mat's edge, a 60px falloff across a 2000px surface — the eye
 * finds that kink as a faint band. Mach banding is a contrast illusion and it
 * survives dithering, so the fix has to be in the curve, not in the pixels.
 */
const smootherstep = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/**
 * Deterministic PRNG. Small, fast, and — the reason it is here rather than
 * `Math.random` — seedable, so the grain on the mat is the same grain every
 * time the game boots and a visual diff between two builds shows only what
 * actually changed.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a, so a caller can seed with a name instead of inventing a number. */
export function seedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Round a float for use in a cache key; three decimals is finer than any pixel. */
const key3 = (value: number): string => (Math.round(value * 1000) / 1000).toString();

// ---------------------------------------------------------------------------
// 3. Canvases, and the memo they live in
// ---------------------------------------------------------------------------

interface Surface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/**
 * A 2D canvas, or null when there is no DOM to make one in.
 *
 * Null is returned rather than thrown for two environments that both matter:
 * node, where the test suite imports screen modules that transitively import
 * this one, and jsdom, which has `document.createElement("canvas")` but returns
 * null from `getContext`. Both must degrade to "no texture", never to a crash.
 */
function surface(width: number, height: number): Surface | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  return ctx ? { canvas, ctx } : null;
}

/**
 * The shared LRU.
 *
 * 192 entries is generous — the whole game asks for maybe thirty distinct
 * textures — and the cap exists only to bound the pathological caller described
 * in the module header. Insertion order is the recency order; a hit re-inserts.
 */
const CACHE_LIMIT = 192;
const cache = new Map<string, unknown>();

function memo<T>(cacheKey: string, make: () => T): T {
  if (cache.has(cacheKey)) {
    const hit = cache.get(cacheKey) as T;
    cache.delete(cacheKey);
    cache.set(cacheKey, hit);
    return hit;
  }
  const made = make();
  cache.set(cacheKey, made);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return made;
}

/**
 * PNG encoding is the expensive half of producing a CSS texture, and most
 * callers only ever want the three.js side. Keyed by canvas so the encode
 * happens at most once per bitmap, whichever caller asks first.
 */
const dataUris = new WeakMap<HTMLCanvasElement, string>();

function dataUriOf(canvas: HTMLCanvasElement | null): string {
  if (!canvas) return "";
  const cached = dataUris.get(canvas);
  if (cached !== undefined) return cached;
  let uri = "";
  try {
    uri = canvas.toDataURL("image/png");
  } catch {
    // A tainted or zero-sized canvas. Neither can happen with the canvases this
    // module makes, but a thrown exception at boot would take the game with it.
    uri = "";
  }
  dataUris.set(canvas, uri);
  return uri;
}

/**
 * A texture from a canvas, or a blank one when there is no canvas.
 *
 * The blank is a real `CanvasTexture` with no image, which three.js treats as
 * "nothing to upload" and skips. That keeps every signature in this file
 * non-nullable: a caller writing `material.alphaMap = softMask(...)` does not
 * have to branch on whether it is running in a browser.
 */
function textureFrom(canvas: HTMLCanvasElement | null, data: boolean): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas ?? (undefined as unknown as HTMLCanvasElement));
  // Masks, noise fields and shadow ramps are *data*. Decoding them as sRGB
  // would apply a gamma curve to numbers that are not colours, which shows up
  // as a soft mask that fades too early and a grain that is twice as loud as
  // the amount asked for.
  texture.colorSpace = data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.anisotropy = 1;
  texture.needsUpdate = true;
  return texture;
}

// ---------------------------------------------------------------------------
// 4. Blur — shared by the grain clumping and the contact shadow
// ---------------------------------------------------------------------------

/**
 * One axis of a box blur over a scalar field, either wrapping or clamping.
 *
 * Wrapping is what keeps a tiled grain seamless; clamping is what keeps a
 * shadow from bleeding round to the other side of its canvas. Sliding-window,
 * so the cost is independent of the radius — which matters because a soft
 * contact shadow can want a radius of forty pixels.
 */
function blurAxis(
  src: Float32Array,
  dst: Float32Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
  wrap: boolean
): void {
  if (radius <= 0) {
    dst.set(src);
    return;
  }
  const length = horizontal ? width : height;
  const lines = horizontal ? height : width;
  const norm = 1 / (radius * 2 + 1);

  const index = (line: number, position: number): number => {
    let p = position;
    if (wrap) p = ((p % length) + length) % length;
    else p = clamp(p, 0, length - 1);
    return horizontal ? line * width + p : p * width + line;
  };

  for (let line = 0; line < lines; line++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += src[index(line, k)]!;
    for (let p = 0; p < length; p++) {
      dst[index(line, p)] = sum * norm;
      sum += src[index(line, p + radius + 1)]! - src[index(line, p - radius)]!;
    }
  }
}

/**
 * Box radii whose triple application approximates a Gaussian of this sigma.
 *
 * The CSS spec defines a `box-shadow` blur radius as a Gaussian with a standard
 * deviation of half the radius, and every browser implements it as three box
 * blurs. Doing the same thing here is not an approximation of the CSS shadow —
 * it is the same construction, which is the only reason the painted texture and
 * the `box-shadow` string returned beside it land on the same silhouette.
 */
function gaussBoxRadii(sigma: number): [number, number, number] {
  if (sigma <= 0) return [0, 0, 0];
  const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower--;
  const upper = lower + 2;
  const crossover = Math.round(
    (12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4)
  );
  const size = (i: number): number => (i < crossover ? lower : upper);
  return [
    Math.max(0, (size(0) - 1) / 2),
    Math.max(0, (size(1) - 1) / 2),
    Math.max(0, (size(2) - 1) / 2),
  ];
}

function blurField(field: Float32Array, width: number, height: number, sigma: number, wrap: boolean): void {
  const radii = gaussBoxRadii(sigma);
  const scratch = new Float32Array(field.length);
  for (const radius of radii) {
    if (radius <= 0) continue;
    blurAxis(field, scratch, width, height, radius, true, wrap);
    blurAxis(scratch, field, width, height, radius, false, wrap);
  }
}

// ---------------------------------------------------------------------------
// 5. Grain
// ---------------------------------------------------------------------------

export interface GrainOptions {
  /** Tile size in texture pixels. Powers of two upload without padding. */
  size?: number;
  /** Peak alpha of the loudest grains, 0–1. §1 of the bar asks for 0.02–0.06. */
  amount?: number;
  seed?: number;
  /**
   * How far the grains clump, as a blur sigma in pixels. 0 is per-pixel film
   * grain; 1–2 gives the softer, coarser dirt that survives being drawn at a
   * fraction of its natural size.
   */
  clump?: number;
  /** three.js only: how many times the tile repeats across the surface. */
  repeat?: number;
}

const GRAIN_DEFAULTS = { size: 128, amount: 0.05, seed: 0x48594245, clump: 0 };

/**
 * Signed noise in [-1, 1], clumped and normalised.
 *
 * Two uniforms summed rather than one, because a single uniform gives the flat
 * hiss of television static while a triangular distribution clusters near zero
 * and puts the energy in a sparse scatter of strong grains — which is what film
 * looks like and what survives being laid over a gradient at 5%.
 *
 * The clumping runs on the signed field rather than on the finished pixels.
 * Blurring the pixels would average white grains into black ones and leave grey,
 * which composites as a tint shift instead of as grain; blurring the signed
 * field just makes the grains bigger. The RMS normalisation afterwards means
 * `amount` says the same thing whatever the clump radius is.
 */
function grainField(size: number, seed: number, clump: number): Float32Array {
  const random = mulberry32(seed);
  const field = new Float32Array(size * size);
  for (let i = 0; i < field.length; i++) field[i] = random() + random() - 1;

  if (clump > 0) {
    blurField(field, size, size, clump, true);
    // Triangular noise on [-1,1] has an RMS of sqrt(1/6); restore it.
    let sumSquares = 0;
    for (let i = 0; i < field.length; i++) sumSquares += field[i]! * field[i]!;
    const rms = Math.sqrt(sumSquares / field.length);
    const gain = rms > 1e-6 ? Math.sqrt(1 / 6) / rms : 1;
    for (let i = 0; i < field.length; i++) field[i] = clamp(field[i]! * gain, -1, 1);
  }
  return field;
}

/**
 * The one grain bitmap, shared by CSS and three.js.
 *
 * Sign becomes colour and magnitude becomes alpha: bright grains are white,
 * dark grains are black, and both are mostly transparent. That is the form that
 * needs no blend mode — it lightens and darkens symmetrically under ordinary
 * compositing, so it behaves identically as a CSS background layer, as a canvas
 * overlay and as a transparent quad in the scene. A white-only grain would need
 * `mix-blend-mode: overlay` to avoid washing everything pale, and blend modes
 * are exactly the sort of thing that behaves differently in the two worlds.
 */
function grainCanvas(size: number, amount: number, seed: number, clump: number): HTMLCanvasElement | null {
  return memo(`grain|${size}|${key3(amount)}|${seed}|${key3(clump)}`, () => {
    const target = surface(size, size);
    if (!target) return null;
    const field = grainField(size, seed, clump);
    const image = target.ctx.createImageData(size, size);
    const pixels = image.data;
    for (let i = 0; i < field.length; i++) {
      const value = field[i]!;
      const level = value >= 0 ? 255 : 0;
      // ^1.25 pushes the weak majority of grains further toward invisible and
      // leaves the strong minority alone, which is the difference between
      // "textured" and "noisy".
      const alpha = Math.pow(Math.abs(value), 1.25) * amount * 255;
      const p = i * 4;
      pixels[p] = level;
      pixels[p + 1] = level;
      pixels[p + 2] = level;
      pixels[p + 3] = Math.round(clamp(alpha, 0, 255));
    }
    target.ctx.putImageData(image, 0, 0);
    return target.canvas;
  });
}

/**
 * The grain as a `data:` URI, for `background-image` and `mask-image`.
 *
 * Returns a bare URI, not `url(...)` — the wrapping belongs to whoever writes
 * the declaration, and `installTextureVars` does it for the two custom
 * properties it publishes.
 */
export function grainDataUri(
  size: number = GRAIN_DEFAULTS.size,
  amount: number = GRAIN_DEFAULTS.amount,
  seed: number = GRAIN_DEFAULTS.seed,
  clump: number = GRAIN_DEFAULTS.clump
): string {
  return dataUriOf(grainCanvas(size, amount, seed, clump));
}

/** The same grain, on the three.js side. Same arguments, same bitmap. */
export function noiseTexture(options: GrainOptions = {}): THREE.CanvasTexture {
  const size = options.size ?? GRAIN_DEFAULTS.size;
  const amount = options.amount ?? GRAIN_DEFAULTS.amount;
  const seed = options.seed ?? GRAIN_DEFAULTS.seed;
  const clump = options.clump ?? GRAIN_DEFAULTS.clump;
  const repeat = options.repeat ?? 1;
  return memo(`noise|${size}|${key3(amount)}|${seed}|${key3(clump)}|${key3(repeat)}`, () => {
    const texture = textureFrom(grainCanvas(size, amount, seed, clump), false);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    return texture;
  });
}

// ---------------------------------------------------------------------------
// 6. The superellipse field, and the soft mask built on it
// ---------------------------------------------------------------------------

/**
 * Signed distance to a rounded rectangle whose corners are superelliptical.
 *
 * Negative inside, zero on the boundary, positive outside, and correct in the
 * interior too — the naive rounded-box distance returns `-radius` everywhere in
 * the middle, which is fine for a hard edge and useless the moment you want to
 * fade inward from the boundary, which is the entire job here.
 *
 * `exponent` shapes the corners: 2 is a true circular arc, 4–5 is the
 * superellipse the bar's §7 asks for (the corner keeps curving into the
 * straight edge instead of meeting it at a tangent point the eye can find),
 * and large values approach a square corner.
 */
function superSdf(
  px: number,
  py: number,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  radius: number,
  exponent: number
): number {
  const r = clamp(radius, 0, Math.min(halfW, halfH));
  const dx = Math.abs(px - cx) - (halfW - r);
  const dy = Math.abs(py - cy) - (halfH - r);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  const outside =
    exponent === 2
      ? Math.sqrt(ox * ox + oy * oy)
      : Math.pow(Math.pow(ox, exponent) + Math.pow(oy, exponent), 1 / exponent);
  return Math.min(Math.max(dx, dy), 0) + outside - r;
}

/** Two octaves of tiling value noise, for edges that should not look computed. */
function valueNoiseSampler(cells: number, seed: number): (u: number, v: number) => number {
  const random = mulberry32(seed);
  const coarse = new Float32Array(cells * cells);
  for (let i = 0; i < coarse.length; i++) coarse[i] = random();
  const fineCells = cells * 2;
  const fine = new Float32Array(fineCells * fineCells);
  for (let i = 0; i < fine.length; i++) fine[i] = random();

  const sample = (grid: Float32Array, n: number, u: number, v: number): number => {
    const x = u * n;
    const y = v * n;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smoothstep(x - x0);
    const fy = smoothstep(y - y0);
    const wrapIndex = (i: number): number => ((i % n) + n) % n;
    const ix0 = wrapIndex(x0);
    const iy0 = wrapIndex(y0);
    const ix1 = wrapIndex(x0 + 1);
    const iy1 = wrapIndex(y0 + 1);
    const a = grid[iy0 * n + ix0]!;
    const b = grid[iy0 * n + ix1]!;
    const c = grid[iy1 * n + ix0]!;
    const d = grid[iy1 * n + ix1]!;
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
  };

  return (u, v) => sample(coarse, cells, u, v) * 0.68 + sample(fine, fineCells, u, v) * 0.32;
}

export interface SoftMaskOptions {
  /** Texture size in pixels. Rounded up to a multiple of 8 so the cache stays small. */
  width?: number;
  height?: number;
  /** Corner radius in the same pixels. */
  radius?: number;
  /** How far the alpha ramp reaches inward from the boundary, in pixels. */
  feather?: number;
  /** Superellipse exponent for the corners. 2 = circular, 4 = squircle. */
  exponent?: number;
  /**
   * Per-edge feather overrides, in pixels. The mat wants its far edge to
   * dissolve into the environment and its near edge to stay definite; a single
   * number cannot say that.
   */
  edgeFeather?: { top?: number; right?: number; bottom?: number; left?: number };
  /**
   * 0–1. Perturbs the falloff with tiling value noise so the edge erodes
   * organically instead of ramping like a gradient tool. It moves the *ramp*,
   * never the interior, so no amount of erosion can punch a hole in the middle.
   */
  erode?: number;
  seed?: number;
}

const roundUp8 = (value: number): number => Math.max(8, Math.ceil(value / 8) * 8);

/**
 * The primitive the battle mat's hard rectangular edge is waiting for.
 *
 * §2 of the bar names that edge as the single worst defect in the game: a
 * painted environment with an opaque rectangle dropped on top of it, so the mat
 * reads as a panel rather than as ground inside the place. A mask cannot fix
 * that on its own, but nothing fixes it without one, and what the mask has to
 * do is more than round the corners — it has to make the boundary *ambiguous*.
 * Hence three separate controls rather than one: the feather sets how far the
 * ambiguity reaches, the exponent decides whether the corner is a shape or an
 * arc bolted onto two straight lines, and the erosion stops the falloff itself
 * from being a perfectly smooth gradient, because nothing in a painted
 * environment has a perfectly smooth edge.
 *
 * Written into all four channels. The alpha channel is what CSS `mask-image`
 * reads and what three.js reads from a `map` on a transparent material; the
 * green channel is what three.js reads from an `alphaMap`. Filling both means
 * the same texture works in every one of those slots without the caller having
 * to know which channel their material samples.
 */
function softMaskCanvas(options: SoftMaskOptions): HTMLCanvasElement | null {
  const width = roundUp8(options.width ?? 512);
  const height = roundUp8(options.height ?? options.width ?? 512);
  const radius = options.radius ?? Math.min(width, height) * 0.08;
  const feather = options.feather ?? Math.min(width, height) * 0.06;
  const exponent = options.exponent ?? 4;
  const erode = clamp(options.erode ?? 0, 0, 1);
  const seed = options.seed ?? GRAIN_DEFAULTS.seed;
  const edges = options.edgeFeather;

  const cacheKey = [
    "softmask",
    width,
    height,
    key3(radius),
    key3(feather),
    key3(exponent),
    key3(erode),
    seed,
    edges ? `${key3(edges.top ?? feather)},${key3(edges.right ?? feather)},${key3(edges.bottom ?? feather)},${key3(edges.left ?? feather)}` : "-",
  ].join("|");

  return memo(cacheKey, () => {
    const target = surface(width, height);
    if (!target) return null;

    const image = target.ctx.createImageData(width, height);
    const pixels = image.data;
    const cx = width / 2;
    const cy = height / 2;
    const halfW = width / 2;
    const halfH = height / 2;

    const featherTop = edges?.top ?? feather;
    const featherRight = edges?.right ?? feather;
    const featherBottom = edges?.bottom ?? feather;
    const featherLeft = edges?.left ?? feather;
    const uniformFeather =
      featherTop === featherRight && featherRight === featherBottom && featherBottom === featherLeft;

    const noise = erode > 0 ? valueNoiseSampler(16, seed) : null;

    for (let y = 0; y < height; y++) {
      const py = y + 0.5;
      for (let x = 0; x < width; x++) {
        const px = x + 0.5;
        let distance = superSdf(px, py, cx, cy, halfW, halfH, radius, exponent);

        /**
         * Blend the four edge feathers by inverse-square proximity to each edge
         * line. At the middle of an edge that edge dominates completely; in a
         * corner the two meeting edges contribute equally, so the feather turns
         * smoothly from one value into the other with no seam to find. Skipped
         * entirely when all four agree, which is the common case and four
         * divisions per pixel cheaper.
         */
        let local = featherTop;
        if (!uniformFeather) {
          const dl = Math.max(px, 0.5);
          const dr = Math.max(width - px, 0.5);
          const dt = Math.max(py, 0.5);
          const db = Math.max(height - py, 0.5);
          const wl = 1 / (dl * dl);
          const wr = 1 / (dr * dr);
          const wt = 1 / (dt * dt);
          const wb = 1 / (db * db);
          local =
            (featherLeft * wl + featherRight * wr + featherTop * wt + featherBottom * wb) /
            (wl + wr + wt + wb);
        }
        if (local <= 0) local = 0.0001;

        if (noise) {
          // Displacing the distance, not the alpha: the ramp wanders in and out
          // by a fraction of its own width and the interior is untouched.
          distance += (noise(px / width, py / height) - 0.5) * erode * local;
        }

        const alpha = smootherstep(-distance / local);
        const level = Math.round(clamp(alpha, 0, 1) * 255);
        const p = (y * width + x) * 4;
        pixels[p] = level;
        pixels[p + 1] = level;
        pixels[p + 2] = level;
        pixels[p + 3] = level;
      }
    }
    target.ctx.putImageData(image, 0, 0);
    return target.canvas;
  });
}

/**
 * An identity for a canvas that does not involve encoding it.
 *
 * `softMask` needs to memoise the *texture* it wraps around an already-memoised
 * canvas, and keying that on the canvas's data URI would defeat the point of
 * the lazy encode. A monotonic id per canvas is enough — two canvases are the
 * same bitmap exactly when they are the same object, because `softMaskCanvas`
 * is itself memoised.
 */
const canvasIds = new WeakMap<HTMLCanvasElement, number>();
let nextCanvasId = 1;
function canvasId(canvas: HTMLCanvasElement): number {
  const existing = canvasIds.get(canvas);
  if (existing !== undefined) return existing;
  const id = nextCanvasId++;
  canvasIds.set(canvas, id);
  return id;
}

/** The soft mask as a three.js texture. Clamped, so the edge cannot wrap. */
export function softMask(options: SoftMaskOptions = {}): THREE.CanvasTexture {
  const canvas = softMaskCanvas(options);
  return memo(`softmask-tex|${canvas ? canvasId(canvas) : "blank"}`, () => {
    const texture = textureFrom(canvas, true);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  });
}

/** The same mask, as a `data:` URI for CSS `mask-image` / `-webkit-mask-image`. */
export function softMaskDataUri(options: SoftMaskOptions = {}): string {
  return dataUriOf(softMaskCanvas(options));
}

// ---------------------------------------------------------------------------
// 7. Bevel
// ---------------------------------------------------------------------------

export interface BevelOptions {
  width?: number;
  height?: number;
  radius?: number;
  exponent?: number;
  /** How far in from the edge the bevel reads, in texture pixels. */
  thickness?: number;
  tier?: MaterialTier | number;
}

export interface BevelResult {
  /** The painted bevel: lit where the edge faces the key light, dark where it turns away. */
  texture: THREE.CanvasTexture;
  /** The same edge as a CSS `box-shadow` value — rim, lip, contact, drop. */
  boxShadow: string;
  /** The painted bevel for CSS, encoded on first access only. */
  readonly dataUri: string;
}

/**
 * One edge treatment, stated twice.
 *
 * It is called a strip because that is what the contract calls it and because a
 * bevel *is* a strip of pixels along an edge — but it is generated as a whole
 * tile, and it has to be. A one-dimensional strip cannot say which side of the
 * object faces the light, so a caller would have to pick per edge, and the
 * moment that is a per-caller decision the game has two suns again. Shading the
 * whole silhouette from `LIGHT_RIG` means the top-left edge comes out lit and
 * the bottom-right comes out dark without anybody choosing.
 *
 * The surface normal comes from the gradient of the same signed-distance field
 * the soft mask uses, so a bevel and a mask built with the same radius and
 * exponent trace exactly the same curve. Lambert against the screen-space light
 * vector then gives a rim that strengthens smoothly around the corner instead of
 * switching at 45°, which is what a four-inset `box-shadow` does and the reason
 * CSS bevels have visible corner seams.
 *
 * Because it is a fixed tile, stretching it non-uniformly stretches the bevel.
 * Generate it at the aspect you will draw it at, or nine-slice it.
 */
export function bevelStrip(options: BevelOptions = {}): BevelResult {
  const width = roundUp8(options.width ?? 256);
  const height = roundUp8(options.height ?? options.width ?? 256);
  const radius = options.radius ?? Math.min(width, height) * 0.08;
  const exponent = options.exponent ?? 4;
  const thickness = options.thickness ?? Math.max(2, Math.min(width, height) * 0.02);
  const amplitude = amplitudeOf(options.tier ?? "panel");

  const cacheKey = `bevel|${width}|${height}|${key3(radius)}|${key3(exponent)}|${key3(thickness)}|${key3(amplitude)}`;

  return memo(cacheKey, () => {
    const canvas = ((): HTMLCanvasElement | null => {
      const target = surface(width, height);
      if (!target) return null;
      const image = target.ctx.createImageData(width, height);
      const pixels = image.data;
      const cx = width / 2;
      const cy = height / 2;
      const halfW = width / 2;
      const halfH = height / 2;
      const at = (px: number, py: number): number =>
        superSdf(px, py, cx, cy, halfW, halfH, radius, exponent);

      for (let y = 0; y < height; y++) {
        const py = y + 0.5;
        for (let x = 0; x < width; x++) {
          const px = x + 0.5;
          const distance = at(px, py);
          const p = (y * width + x) * 4;
          // Outside the shape, or deeper in than the bevel reaches.
          if (distance > 0 || distance < -thickness) {
            pixels[p + 3] = 0;
            continue;
          }
          // Outward normal by central difference on the distance field.
          const nx = at(px + 1, py) - at(px - 1, py);
          const ny = at(px, py + 1) - at(px, py - 1);
          const length = Math.hypot(nx, ny) || 1;
          const lambert = (nx / length) * LIGHT_RIG.screen.x + (ny / length) * LIGHT_RIG.screen.y;
          // Strongest at the boundary, gone by `thickness` inward.
          const profile = smootherstep(1 + distance / thickness);
          const strength = Math.pow(Math.abs(lambert), 1.1) * profile * amplitude;
          const lit = lambert > 0;
          const level = lit ? 255 : 0;
          pixels[p] = level;
          pixels[p + 1] = level;
          pixels[p + 2] = level;
          // The unlit lip carries more weight than the lit rim: a highlight at
          // the same alpha as its shadow reads as chalk rather than as light.
          pixels[p + 3] = Math.round(clamp(strength * (lit ? 0.42 : 0.62), 0, 1) * 255);
        }
      }
      target.ctx.putImageData(image, 0, 0);
      return target.canvas;
    })();

    const texture = textureFrom(canvas, false);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    const rim = key3(0.16 * amplitude);
    const rimSide = key3(0.1 * amplitude);
    const lip = key3(0.34 * amplitude);
    const lipSide = key3(0.2 * amplitude);
    const lift = 2 + 6 * amplitude;
    const offset = shadowOffset(lift);
    const dropBlur = Math.round(10 + 22 * amplitude);
    const drop = key3(0.3 * amplitude);
    const contact = key3(0.42 * amplitude);

    /**
     * Painting order, and why the contact shadow is listed before the drop:
     * earlier shadows paint over later ones, and the tight one is the one that
     * has to stay crisp. The two side insets are at ~60% of the top and bottom
     * because the light is at 45° — an edge facing left catches the same light
     * as one facing up, but the eye reads vertical rim light as stronger and
     * matching them exactly makes the panel look inflated.
     */
    const boxShadow = [
      `inset 0 1px 0 rgba(255, 255, 255, ${rim})`,
      `inset 1px 0 0 rgba(255, 255, 255, ${rimSide})`,
      `inset 0 -1px 0 rgba(0, 0, 0, ${lip})`,
      `inset -1px 0 0 rgba(0, 0, 0, ${lipSide})`,
      `0 1px 2px rgba(0, 0, 0, ${contact})`,
      `${offset.x.toFixed(1)}px ${offset.y.toFixed(1)}px ${dropBlur}px rgba(0, 0, 0, ${drop})`,
    ].join(", ");

    return {
      texture,
      boxShadow,
      get dataUri(): string {
        return dataUriOf(canvas);
      },
    } as BevelResult;
  });
}

// ---------------------------------------------------------------------------
// 8. Contact shadow
// ---------------------------------------------------------------------------

export interface ContactShadowOptions {
  width?: number;
  height?: number;
  radius?: number;
  exponent?: number;
  /** Height above the backing, in CSS pixels. Drives both the blur and the offset. */
  lift?: number;
  opacity?: number;
  tier?: MaterialTier | number;
}

export interface ContactShadowResult {
  /** A ground-plane shadow: the soft drop and the tight contact, composited. */
  texture: THREE.CanvasTexture;
  /** The same shadow as a CSS `box-shadow` value. */
  css: string;
  /** Transparent margin around the shape inside the texture, in texture pixels. */
  padding: number;
  /** Full texture dimensions, so a three.js plane can be sized to match. */
  size: { width: number; height: number };
  readonly dataUri: string;
}

/**
 * What turns a rectangle into an object.
 *
 * §1 of the bar is blunt about it: a panel floating with no shadow is a
 * rectangle, and a panel with a soft drop *and* a tight two-pixel contact
 * shadow is an object. Two shadows, not one — the soft drop says how far above
 * the backing the thing is, and the tight one says it is touching. Drop the
 * tight one and everything on the screen appears to hover at the same height.
 *
 * The texture is built with the same three-box Gaussian a browser uses for
 * `box-shadow`, at the sigma the CSS spec defines, so the painted shadow under a
 * card in the scene and the CSS shadow under the panel beside it are the same
 * shadow rather than two people's idea of one.
 */
export function contactShadow(options: ContactShadowOptions = {}): ContactShadowResult {
  const shapeWidth = roundUp8(options.width ?? 256);
  const shapeHeight = roundUp8(options.height ?? options.width ?? 256);
  const radius = options.radius ?? Math.min(shapeWidth, shapeHeight) * 0.08;
  const exponent = options.exponent ?? 4;
  const amplitude = amplitudeOf(options.tier ?? "panel");
  const lift = options.lift ?? 2 + 6 * amplitude;
  const opacity = options.opacity ?? 0.3 * amplitude;

  const dropSigma = (10 + 22 * amplitude) / 2;
  const offset = shadowOffset(lift);
  const padding = Math.ceil(dropSigma * 3 + Math.max(Math.abs(offset.x), Math.abs(offset.y)) + 2);
  const width = shapeWidth + padding * 2;
  const height = shapeHeight + padding * 2;

  const cacheKey = `contact|${shapeWidth}|${shapeHeight}|${key3(radius)}|${key3(exponent)}|${key3(lift)}|${key3(opacity)}|${key3(amplitude)}`;

  return memo(cacheKey, () => {
    const canvas = ((): HTMLCanvasElement | null => {
      const target = surface(width, height);
      if (!target) return null;

      /** Anti-aliased coverage of the silhouette, sampled from the distance field. */
      const coverage = new Float32Array(width * height);
      const cx = width / 2;
      const cy = height / 2;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const d = superSdf(x + 0.5, y + 0.5, cx, cy, shapeWidth / 2, shapeHeight / 2, radius, exponent);
          coverage[y * width + x] = clamp(0.5 - d, 0, 1);
        }
      }

      const soft = Float32Array.from(coverage);
      blurField(soft, width, height, dropSigma, false);
      const tight = Float32Array.from(coverage);
      blurField(tight, width, height, 1, false);

      const image = target.ctx.createImageData(width, height);
      const pixels = image.data;
      const dropOffsetX = Math.round(offset.x);
      const dropOffsetY = Math.round(offset.y);
      const contactOffsetY = 1;
      const contactAlpha = 0.42 * amplitude;

      const sample = (field: Float32Array, x: number, y: number): number => {
        if (x < 0 || y < 0 || x >= width || y >= height) return 0;
        return field[y * width + x]!;
      };

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dropValue = sample(soft, x - dropOffsetX, y - dropOffsetY) * opacity;
          const contactValue = sample(tight, x, y - contactOffsetY) * contactAlpha;
          // Over-compositing two black layers rather than adding them, so a
          // deep overlap saturates toward opaque instead of past it.
          const alpha = dropValue + contactValue * (1 - dropValue);
          const p = (y * width + x) * 4;
          pixels[p] = 0;
          pixels[p + 1] = 0;
          pixels[p + 2] = 0;
          pixels[p + 3] = Math.round(clamp(alpha, 0, 1) * 255);
        }
      }
      target.ctx.putImageData(image, 0, 0);
      return target.canvas;
    })();

    const texture = textureFrom(canvas, false);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    const css = [
      `0 1px 2px rgba(0, 0, 0, ${key3(0.42 * amplitude)})`,
      `${offset.x.toFixed(1)}px ${offset.y.toFixed(1)}px ${Math.round(dropSigma * 2)}px rgba(0, 0, 0, ${key3(opacity)})`,
    ].join(", ");

    return {
      texture,
      css,
      padding,
      size: { width, height },
      get dataUri(): string {
        return dataUriOf(canvas);
      },
    } as ContactShadowResult;
  });
}

// ---------------------------------------------------------------------------
// 9. Fading dividers
// ---------------------------------------------------------------------------

export interface FadeStripResult {
  texture: THREE.CanvasTexture;
  /** A CSS `mask-image` value — a gradient, so no data URI is involved. */
  maskImage: string;
}

/**
 * The divider primitive: alpha ramping to zero across the outer `taper` at each
 * end.
 *
 * §7 makes end-fading a rule. A hairline that butts hard into a panel edge is
 * the tell that the divider was placed by a layout engine rather than drawn by
 * somebody; every rule in the reference games fades out before it reaches
 * anything.
 *
 * The CSS side emits five stops through the taper rather than two, because a
 * two-stop `transparent → black` ramp is linear in alpha and the eye finds the
 * hard start of it. The extra stops trace a smootherstep, which costs three
 * commas and removes the band.
 */
export function fadeStrip(taper = 0.15, axis: "x" | "y" = "x"): FadeStripResult {
  const clamped = clamp(taper, 0, 0.5);
  return memo(`fade|${key3(clamped)}|${axis}`, () => {
    const length = 256;
    const across = 4;
    const width = axis === "x" ? length : across;
    const height = axis === "x" ? across : length;

    const ramp = (t: number): number => {
      if (clamped <= 0) return 1;
      if (t < clamped) return smootherstep(t / clamped);
      if (t > 1 - clamped) return smootherstep((1 - t) / clamped);
      return 1;
    };

    const canvas = ((): HTMLCanvasElement | null => {
      const target = surface(width, height);
      if (!target) return null;
      const image = target.ctx.createImageData(width, height);
      const pixels = image.data;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const t = ((axis === "x" ? x : y) + 0.5) / length;
          const level = Math.round(ramp(t) * 255);
          const p = (y * width + x) * 4;
          pixels[p] = level;
          pixels[p + 1] = level;
          pixels[p + 2] = level;
          pixels[p + 3] = level;
        }
      }
      target.ctx.putImageData(image, 0, 0);
      return target.canvas;
    })();

    const texture = textureFrom(canvas, true);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    const stops: string[] = [];
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const position = (clamped * i) / steps;
      stops.push(`rgba(0, 0, 0, ${key3(ramp(position))}) ${key3(position * 100)}%`);
    }
    for (let i = steps; i >= 0; i--) {
      const position = 1 - (clamped * i) / steps;
      stops.push(`rgba(0, 0, 0, ${key3(ramp(position))}) ${key3(position * 100)}%`);
    }
    const direction = axis === "x" ? "90deg" : "180deg";

    return { texture, maskImage: `linear-gradient(${direction}, ${stops.join(", ")})` };
  });
}

// ---------------------------------------------------------------------------
// 10. Rim gradient
// ---------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Anything with a key colour and a light and dark shade of it.
 *
 * Structural rather than an import of `CurrentPalette`, so a caller can pass a
 * Current's palette, a faction colour worked up on the spot, or a rarity — all
 * three want the same gradient and none of them should have to pretend to be a
 * Current to get it.
 */
export interface RimPalette {
  key: string;
  hi: string;
  lo: string;
  abyss?: string;
}

/**
 * A two-stop-plus gradient along the light vector, lit corner last.
 *
 * The stop order matches CSS `linear-gradient(315deg, …)`: the gradient runs
 * from the unlit bottom-right corner to the lit top-left one, so a canvas fill
 * and a CSS declaration written from the same palette produce the same surface.
 * The geometry is CSS's too — the gradient line is projected so that both
 * extreme corners of the rectangle land exactly on the ends, which is what stops
 * a wide panel and a tall one from having visibly different amounts of light on
 * them.
 *
 * Not memoised, on purpose — see the module header.
 */
export function rimGradient(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  palette: RimPalette,
  tier: MaterialTier | number = "panel"
): CanvasGradient {
  const amplitude = amplitudeOf(tier);
  // Toward the light in canvas coordinates, where y grows downward.
  const dirX = LIGHT_RIG.screen.x;
  const dirY = LIGHT_RIG.screen.y;
  const span = Math.abs(rect.w * dirX) + Math.abs(rect.h * dirY);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const gradient = ctx.createLinearGradient(
    cx - (dirX * span) / 2,
    cy - (dirY * span) / 2,
    cx + (dirX * span) / 2,
    cy + (dirY * span) / 2
  );

  const shade = palette.abyss ?? mix(palette.lo, "#000000", 0.4);
  gradient.addColorStop(0, mix(palette.key, shade, clamp(0.62 * amplitude, 0, 1)));
  gradient.addColorStop(0.38, mix(palette.key, palette.lo, clamp(0.3 * amplitude, 0, 1)));
  gradient.addColorStop(0.72, palette.key);
  // The last stretch is the specular kick on the lit corner. Two stops, close
  // together, because a single ramp to the highlight spreads it over the whole
  // panel and reads as a pale wash rather than as light catching an edge.
  gradient.addColorStop(0.92, mix(palette.key, palette.hi, clamp(0.34 * amplitude, 0, 1)));
  gradient.addColorStop(1, mix(palette.key, palette.hi, clamp(0.66 * amplitude, 0, 1)));
  return gradient;
}

// ---------------------------------------------------------------------------
// 11. Environment
// ---------------------------------------------------------------------------

const environments = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();
const environmentTargets: THREE.WebGLRenderTarget[] = [];

/** Where a direction lands on an equirectangular image, in pixels. */
function equirectPixel(direction: THREE.Vector3, width: number, height: number): { x: number; y: number } {
  const u = Math.atan2(direction.z, direction.x) / (Math.PI * 2) + 0.5;
  const v = Math.asin(clamp(direction.y, -1, 1)) / Math.PI + 0.5;
  // v = 1 is up, and image row 0 is up, because three.js flips textures on upload.
  return { x: u * width, y: (1 - v) * height };
}

/**
 * A prefiltered environment for anything with a `MeshStandardMaterial` on it.
 *
 * Without one, every metal and every gloss in the scene reflects a uniform grey
 * and the card frames look like painted plastic — an environment map is most of
 * what "material" means to a PBR shader. Loading an HDR is the normal answer and
 * it is not available here: nothing is fetched, and there is no budget for a
 * paid HDRI. So the environment is painted, as a 512×256 equirectangular canvas
 * with the key blob placed at the exact position `LIGHT_RIG.world` projects to.
 * A reflection that disagrees with the key light is worse than no reflection,
 * because it puts a second highlight on the wrong side of every glossy edge.
 *
 * The magenta and cyan are the game's own accents rather than a neutral studio
 * grey: this is a nightlife setting and the reflections should say so.
 *
 * Memoised per renderer, which is the only sensible key — a PMREM target belongs
 * to the GL context that produced it.
 */
export function studioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const existing = environments.get(renderer);
  if (existing) return existing;

  const width = 512;
  const height = 256;
  const target = surface(width, height);
  if (!target) return new THREE.Texture();
  const { ctx } = target;

  // Sky: violet zenith, warmer at the horizon, near-black underfoot.
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#1b1236");
  sky.addColorStop(0.44, "#2a1c4c");
  sky.addColorStop(0.52, "#160e2a");
  sky.addColorStop(1, "#060410");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const blob = (
    at: { x: number; y: number },
    radius: number,
    colour: string,
    strength: number
  ): void => {
    // Drawn three times across the seam so a light near u=0 is not cut in half.
    for (const shift of [-width, 0, width]) {
      const gradient = ctx.createRadialGradient(at.x + shift, at.y, 0, at.x + shift, at.y, radius);
      gradient.addColorStop(0, hexToRgba(colour, clamp(strength, 0, 1)));
      gradient.addColorStop(0.45, hexToRgba(colour, clamp(strength * 0.42, 0, 1)));
      gradient.addColorStop(1, hexToRgba(colour, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }
  };

  const keyAt = equirectPixel(LIGHT_RIG.world, width, height);
  const fillDirection = LIGHT_RIG.world.clone();
  fillDirection.x *= -1;
  fillDirection.z *= -1;
  fillDirection.y = 0.18;
  fillDirection.normalize();
  const rimDirection = new THREE.Vector3(-LIGHT_RIG.world.z, 0.08, LIGHT_RIG.world.x).normalize();

  blob(keyAt, height * 0.62, "#fff4e2", clamp(LIGHT_RIG.key / 2.6, 0, 1));
  blob(equirectPixel(fillDirection, width, height), height * 0.9, "#52c8ff", clamp(LIGHT_RIG.fill / 1.6, 0, 1));
  blob(equirectPixel(rimDirection, width, height), height * 0.7, "#ff5fa2", clamp(LIGHT_RIG.rim / 3.4, 0, 1));

  const source = new THREE.CanvasTexture(target.canvas);
  source.mapping = THREE.EquirectangularReflectionMapping;
  source.colorSpace = THREE.SRGBColorSpace;
  source.needsUpdate = true;

  const generator = new THREE.PMREMGenerator(renderer);
  generator.compileEquirectangularShader();
  const renderTarget = generator.fromEquirectangular(source);
  generator.dispose();
  source.dispose();

  environmentTargets.push(renderTarget);
  environments.set(renderer, renderTarget.texture);
  return renderTarget.texture;
}

// ---------------------------------------------------------------------------
// 12. Current glow
// ---------------------------------------------------------------------------

export interface CurrentGlow {
  /** A CSS `box-shadow` value; works as `filter: drop-shadow` chains too. */
  css: string;
  /** Shared and read-only — `.clone()` before assigning it somewhere mutable. */
  emissive: THREE.Color;
  /** A multiplier for `emissiveIntensity` or a bloom pass's strength. */
  bloom: number;
}

/** Relative luminance of an `#rrggbb`, sRGB weights, no gamma decode needed here. */
function luminanceOf(hex: string): number {
  const value = parseInt(hex.replace("#", ""), 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The glow for a Current, in CSS and in the scene, at matched strength.
 *
 * The bloom figure is not proportional to `intensity` alone. Halo is a pale
 * yellow and Veil is a deep violet; run through the same bloom pass at the same
 * strength, Halo blows out into a white smear while Veil barely registers, and
 * the player reads that as Halo being the more important card. Dividing by
 * luminance normalises them, so "intensity 1" means the same amount of
 * *perceived* glow whichever Current is glowing.
 *
 * The cache key carries the resolved hue rather than the Current's id, which is
 * what makes this safe under the colour-blind modes: those mutate
 * `CURRENT_PALETTE` in place, so keying on the id would hand back the previous
 * mode's glow forever. Intensity is quantised to hundredths so a caller lerping
 * a glow over a frame does not mint a new entry every frame.
 */
export function currentGlow(currentId: CurrentId, intensity = 1): CurrentGlow {
  const palette = CURRENT_PALETTE[currentId];
  const strength = clamp(intensity, 0, 2);
  const quantised = Math.round(strength * 100) / 100;
  return memo(`glow|${palette.key}|${quantised}`, () => {
    const luminance = luminanceOf(palette.key);
    const inner = Math.round(6 + 10 * quantised);
    const middle = Math.round(16 + 26 * quantised);
    const outer = Math.round(34 + 52 * quantised);
    return {
      css: [
        `0 0 ${inner}px ${hexToRgba(palette.hi, clamp(0.5 * quantised, 0, 1))}`,
        `0 0 ${middle}px ${hexToRgba(palette.key, clamp(0.42 * quantised, 0, 1))}`,
        `0 0 ${outer}px ${hexToRgba(palette.key, clamp(0.22 * quantised, 0, 1))}`,
      ].join(", "),
      emissive: new THREE.Color(palette.key),
      bloom: clamp(quantised * (0.62 / (0.32 + luminance)), 0, 2),
    };
  });
}

// ---------------------------------------------------------------------------
// 13. Scaled assets
// ---------------------------------------------------------------------------

/**
 * A 512px PNG, resampled once, at the size it is actually drawn.
 *
 * Nineteen Current and crest icons are 512×512 masters and the card renderer
 * draws them into a 28px box. Every one of those draws makes the browser
 * resample a quarter of a million pixels down to eight hundred, on the main
 * thread, for a picture that has not changed — and because a single-step
 * downscale of that ratio skips most of the source, the result also aliases:
 * thin strokes flicker between frames as the sample grid shifts by a fraction
 * of a pixel.
 *
 * Both problems have the same fix. Halving repeatedly is an exact box filter —
 * every source pixel contributes to the result, which is what mipmapping does
 * and why mipmaps do not shimmer — and caching the result means the work
 * happens once per icon per size for the life of the page instead of once per
 * draw.
 *
 * Sizes are rounded up to a power of two so the halving chain lands exactly and
 * so the cache holds a handful of entries per asset rather than one per pixel
 * size any caller ever asked for. Pass **device** pixels: if you are drawing at
 * 28 CSS pixels on a canvas backed at 2×, ask for 56.
 *
 * Returns null while the asset is loading and forever if it is missing, exactly
 * like `getAsset` — the caller draws its fallback, which every caller of
 * `getAsset` already has.
 */
export function scaledAsset(
  path: string,
  targetPx: number,
  extensions: readonly string[] = ["png"]
): HTMLCanvasElement | HTMLImageElement | null {
  const image = getAsset(path, extensions);
  if (!image || !image.naturalWidth || !image.naturalHeight) return null;

  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  const wanted = Math.max(8, Math.ceil(targetPx));
  const bucket = Math.pow(2, Math.ceil(Math.log2(wanted)));
  // Never upscale, and do not bother copying something already close to size:
  // one browser resample of a 2:1 ratio is cheap and visually identical.
  if (bucket >= longest) return image;

  const cacheKey = `asset|${path}|${bucket}`;
  return memo(cacheKey, () => {
    const scale = bucket / longest;
    let sourceWidth = image.naturalWidth;
    let sourceHeight = image.naturalHeight;
    let current: HTMLCanvasElement | HTMLImageElement = image;

    // Halve until one more halving would undershoot the target.
    while (sourceWidth / 2 >= image.naturalWidth * scale && sourceHeight / 2 >= 1) {
      const half = surface(Math.max(1, Math.round(sourceWidth / 2)), Math.max(1, Math.round(sourceHeight / 2)));
      if (!half) return null;
      half.ctx.imageSmoothingEnabled = true;
      half.ctx.imageSmoothingQuality = "high";
      half.ctx.drawImage(current, 0, 0, half.canvas.width, half.canvas.height);
      current = half.canvas;
      sourceWidth = half.canvas.width;
      sourceHeight = half.canvas.height;
    }

    const finalWidth = Math.max(1, Math.round(image.naturalWidth * scale));
    const finalHeight = Math.max(1, Math.round(image.naturalHeight * scale));
    if (sourceWidth === finalWidth && sourceHeight === finalHeight && current !== image) {
      return current;
    }
    const final = surface(finalWidth, finalHeight);
    if (!final) return null;
    final.ctx.imageSmoothingEnabled = true;
    final.ctx.imageSmoothingQuality = "high";
    final.ctx.drawImage(current, 0, 0, finalWidth, finalHeight);
    return final.canvas;
  });
}

// ---------------------------------------------------------------------------
// 14. Boot
// ---------------------------------------------------------------------------

/**
 * One grain per material rank, and the reason it is four tiles rather than one.
 *
 * This shipped as two tiles — a coarse one at amount 0.06 and a "fine" one at
 * 0.1 shown at half size — and both of those decisions were wrong for the same
 * reason the rim and the lip were wrong before module A §3 fixed them: **the
 * grain was specified as an alpha and it needs to be specified as a contrast.**
 *
 * Measured on an ordinary 1× monitor, the two tiles produced almost identical
 * high-pass amplitudes on all four plates — SD 2.85 / 2.48 / 3.02 / 2.88 — while
 * the faces underneath them run 163 / 58 / 39 / 13. Against its own plate that
 * is 1.75% on the hero, 4.3% on the chip, 7.7% on the panel and 22.0% on the
 * well: a 12.6× spread, and at 4× it was 1.1% against 25%. Crop the same patch
 * out of each and stack them and the hero is clean CSS while the well is a
 * salt-and-pepper field that reads as sensor noise rather than as dirt on a
 * surface. Texture is the one ingredient §1 names as the difference between a
 * real surface and a gradient, and it was the ingredient the family agreed on
 * least.
 *
 * So each rank gets its own tile, its amount solved backwards from
 * `grainContrast` and then **checked against the rendered page**, because a
 * model is a way of getting close and a pipette is the thing a critic will use.
 * `contrast` below is that measurement: the high-pass SD of the whole plate
 * divided by its own mean luma, taken off the gallery's A1 comparison row at 1×
 * with the animations pinned and the centred label excluded from the crop. The
 * test asserts those four stay within 1.5× of each other, and separately that
 * each one still agrees with the model, so an amount cannot be edited without
 * the measurement being redone.
 *
 * **The target is 6.5%, which is roughly where the panel already was.** Of the
 * four, the panel was the one a reviewer looking at cropped patches called
 * correct; the arithmetic middle of the four was about 4%, and taking everything
 * to 4% would have quietened the one plate nobody had a complaint about, on a
 * page whose grain-on/grain-off pair has already failed once for being too
 * subtle to tell apart at 1:1. 6.5% leaves the panel where it was, brings the
 * hero up by a factor of nearly four and takes the well down by two thirds.
 *
 * **The well is the exception and the reason is not the grain.** With
 * `--mat-grain: none` the well plate *still* measures a high-pass ratio of 8.2%,
 * because Chromium dithers its near-black gradient and its inset recess shadow,
 * and one level of dither over a face of thirteen is 8%. That is a floor no
 * amount can get under — the same dither is 0.8% on the hero, where the face is
 * eleven times higher. So the well is given a token 0.008 whose own contribution
 * is about 3.4% of face, landing the total at 8.7%: within 1.4× of the other
 * three, which is as close as the engine allows, and the remaining gap is
 * substrate rather than decoration.
 *
 * ## Every tile is shown at one cell per CSS pixel, and that is the other fix
 *
 * The old `--tex-grain-fine` was a 128px tile displayed at 64px, on the
 * reasoning that half-size cells "average down". They average down at 1× and
 * they do not average at all from 2× upward, where each cell lands on a whole
 * device pixel — so the fine grain was quietly twice as loud on every retina
 * display, and the two materials that used it (`.mat-chip`, `.mat-well`) are the
 * two darkest in the system, where loud grain hurts most. Display size now
 * always equals tile size, so `amount` means the same thing on every display and
 * the only knob left is the one that is tuned.
 *
 * The chip and well tiles are 64px rather than 128px purely to keep the boot
 * cost down: they land on small objects where a 64px repeat cannot be seen at
 * one to two percent contrast, and four 128px tiles would be four PNG encodes
 * and a quarter of a megabyte of base64 in a `<style>` element.
 *
 * Each name must be paired with its size variable:
 *
 *     background-image: var(--tex-grain-chip);
 *     background-size: var(--tex-grain-chip-size);
 *
 * ## The amounts are the peak, and the peak is rare
 *
 * `amount` is the alpha of the *loudest* grain in the tile, not the average one.
 * The field is triangular noise raised to the 1.25 power, so the mean absolute
 * value lands near a quarter of the peak. That is why the hero's 0.225 is not a
 * 22% haze over the PLAY button — it is a sparse scatter of strong grains on a
 * plate bright enough to swallow them, which is exactly what the hero needed and
 * never had.
 *
 * `baseline` is what the plate measures with the grain layer switched off: the
 * dither and banding the fill and the shadows produce on their own. It is
 * recorded because it is the thing that explains the well, and because
 * subtracting it in quadrature is the only way to compare the *grain* across
 * four substrates that are not equally quiet to begin with.
 */
export interface GrainTier {
  /** The custom property module A points a material at. */
  name: string;
  /** Tile size in pixels, always also the display size — see above. */
  tile: number;
  /** Peak alpha of the loudest grains. */
  amount: number;
  /** Measured high-pass ratio of the plate with the grain off. */
  baseline: number;
  /** Measured high-pass ratio of the plate as it ships. */
  contrast: number;
}

const GRAIN_TIERS: Readonly<Record<MaterialTier, GrainTier>> = Object.freeze({
  hero: { name: "--tex-grain-hero", tile: 128, amount: 0.225, baseline: 0.008, contrast: 0.066 },
  panel: { name: "--tex-grain-mid", tile: 128, amount: 0.04, baseline: 0.02, contrast: 0.065 },
  chip: { name: "--tex-grain-chip", tile: 64, amount: 0.068, baseline: 0.014, contrast: 0.067 },
  well: { name: "--tex-grain-well", tile: 64, amount: 0.008, baseline: 0.082, contrast: 0.087 },
});

/** The whole table, for the gallery and for the test that keeps it honest. */
export function grainTier(tier: MaterialTier): GrainTier {
  return GRAIN_TIERS[tier];
}

/**
 * What each rank's plate actually measures, as a fraction of its own face —
 * grain, dither and all, which is what a pipette sees.
 */
export function grainContrastOf(tier: MaterialTier): number {
  return GRAIN_TIERS[tier].contrast;
}

/** The tier tiles, plus the two legacy names every existing rule still asks for. */
const GRAIN_VARS = (
  ["hero", "panel", "chip", "well"] as const
).map((tier) => ({
  name: GRAIN_TIERS[tier].name,
  size: GRAIN_TIERS[tier].tile,
  amount: GRAIN_TIERS[tier].amount,
  clump: 0,
  display: GRAIN_TIERS[tier].tile,
  seed: GRAIN_DEFAULTS.seed ^ seedFrom(tier),
}));

/**
 * `--tex-grain` and `--tex-grain-fine` are kept as aliases rather than deleted.
 *
 * They are the names in the two rules module A has not migrated and in anything
 * a screen wrote against them, and an alias costs one line of CSS where a fifth
 * bitmap would cost another PNG encode. `--tex-grain` points at the mid tile
 * because an unclassified surface falls through to `--fill-panel`, and
 * `--tex-grain-fine` at the well tile because every remaining use of it is a
 * field, which is a well.
 */
const GRAIN_ALIASES: readonly { name: string; of: MaterialTier }[] = [
  { name: "--tex-grain", of: "panel" },
  { name: "--tex-grain-fine", of: "well" },
];

const STYLE_ID = "hb-texture-vars";

let varsInstalled = false;

/**
 * Publish the grain to CSS.
 *
 * Idempotent, and a no-op wherever there is no document — this module is
 * imported by code that runs under node, and the guard is what lets that
 * import be free rather than a reason to mock the DOM.
 *
 * It runs on import as well as being exported, because module A's stylesheet
 * references `var(--tex-grain)` and a custom property that arrives after the
 * first paint means a visible pass with no texture on any surface. The cost is
 * two PNG encodes of a 128px tile, once, at boot.
 *
 * ## Why a stylesheet rule and not `documentElement.style`
 *
 * The obvious implementation is `root.style.setProperty("--tex-grain", …)`, and
 * it breaks high contrast. `foundation.css` turns the texture off with
 * `:root[data-contrast="high"] { --tex-grain: none }` — 4% decoration is
 * precisely what that setting exists to remove — and an inline style beats
 * every selector in the cascade, so the accessibility switch would go dead the
 * moment this module was imported. Nothing would look broken; the setting would
 * simply stop working, which is the worst way for an accessibility feature to
 * fail.
 *
 * Injecting a `:root { … }` rule instead puts these declarations exactly where
 * they belong in the cascade: lower than any `:root[data-…]` override, so every
 * setting that wants to change or remove the grain still can.
 */
export function installTextureVars(): void {
  if (varsInstalled || typeof document === "undefined") return;
  varsInstalled = true;

  const declarations: string[] = [];
  for (const grain of GRAIN_VARS) {
    const uri = grainDataUri(grain.size, grain.amount, grain.seed, grain.clump);
    if (!uri) continue;
    declarations.push(`  ${grain.name}: url("${uri}");`);
    declarations.push(`  ${grain.name}-size: ${grain.display}px;`);
  }
  if (declarations.length === 0) return;
  for (const alias of GRAIN_ALIASES) {
    const target = GRAIN_TIERS[alias.of].name;
    declarations.push(`  ${alias.name}: var(${target});`);
    declarations.push(`  ${alias.name}-size: var(${target}-size);`);
  }

  const style = document.getElementById(STYLE_ID) ?? createStyleElement(document);
  style.id = STYLE_ID;
  style.textContent = `:root {\n${declarations.join("\n")}\n}\n`;
  // Appended last so that, against a declaration of equal specificity in
  // `foundation.css`, source order settles it in favour of the real texture.
  (document.head ?? document.documentElement).appendChild(style);
}

/**
 * Test seam: forget every cached bitmap, texture and environment.
 *
 * This is the one place disposal is safe, because a test that resets the cache
 * is not also mid-render. Everything else deliberately leaks its GPU handles
 * rather than risk pulling a texture out from under a live material — see the
 * module header.
 */
export function resetTextureCache(): void {
  for (const value of cache.values()) {
    if (value === null || typeof value !== "object") continue;
    const held = (value as { texture?: unknown }).texture ?? value;
    if (held instanceof THREE.Texture) held.dispose();
  }
  cache.clear();
  for (const target of environmentTargets.splice(0)) target.dispose();
  if (typeof document !== "undefined") document.getElementById(STYLE_ID)?.remove();
  varsInstalled = false;
}

/**
 * Boot. Wrapped, because a texture is decoration and a decoration that throws
 * during module evaluation takes the whole game down with it.
 */
try {
  installTextureVars();
} catch {
  /* no grain, still a game */
}
