/**
 * Every pixel the opening cinematics are made of, generated at boot.
 *
 * There are exactly two image files in this whole sequence — `hb-mark-master`
 * and `hb-wordmark`, the real brand assets — and everything else on screen is
 * computed here: the light shafts, the out-of-focus city behind them, the
 * shockwave, the anamorphic streak, the lens flash, the vignette. Nothing is
 * fetched, because the privacy screen promises this build fetches nothing, and a
 * title sequence is the single easiest place in a game to break that promise
 * without noticing.
 *
 * ## Why the glow around the logo is a blurred copy of the logo
 *
 * The obvious way to make a mark glow is a coloured radial gradient behind it.
 * That is what a hobby project does and it is visible immediately: the halo is a
 * circle and the mark is not, so the light appears to come from a lamp *behind*
 * the object rather than from the object itself. A neon sign's halo is the sign,
 * smeared — the bar of the H throws a bar of light, the corner of the badge
 * throws a corner. So `bloomOf` blurs the artwork and draws it back additively
 * at two radii, which costs two canvas operations at boot and is the difference
 * between a logo with a glow behind it and a logo that is switched on.
 *
 * It also means the halo is coloured by the artwork rather than by a constant
 * somebody picked, so the magenta side of the badge glows magenta and the violet
 * side glows violet without anybody sampling anything.
 *
 * ## Everything here shares the game's light and the game's grain
 *
 * The beam texture's falloff, the vignette's centre offset and the wash's key
 * position all come from `LIGHT_RIG`, so the cinematic is lit from 315° like
 * every panel in the game. The film grain is not generated here at all — it is
 * `texture.ts`'s grain, cloned so this module can give it its own tiling without
 * mutating the one every DOM surface is already using. One grain in the build,
 * as §1 requires; two would read as two materials the moment the intro
 * cross-fades into the lobby.
 *
 * ## Disposal is tracked, and shared textures are excluded from it
 *
 * The intro is torn down seconds after it starts and must give its GPU memory
 * back — a title card holding twenty megabytes for the rest of the session is a
 * leak with a nice picture on it. `own()` records everything this module
 * allocated; `disposeIntroTextures()` frees exactly that and nothing else, which
 * is why the grain is cloned rather than used directly. Disposing a texture that
 * `texture.ts` memoised would turn every material in the game black.
 */

import * as THREE from "three";
import { LIGHT_RIG, noiseTexture } from "../art/texture";
import { CURRENT_PALETTE, hexToRgba } from "../cardRenderer/palette";
import type { CurrentId } from "../../engine/types";
import type { RoomLight } from "../atmosphere";

/** Everything this module allocated, so teardown frees it and nothing else. */
const owned = new Set<THREE.Texture>();

function own<T extends THREE.Texture>(texture: T): T {
  owned.add(texture);
  return texture;
}

function canvas(width: number, height: number): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  const element = document.createElement("canvas");
  element.width = Math.max(1, Math.round(width));
  element.height = Math.max(1, Math.round(height));
  return element.getContext("2d");
}

/**
 * A texture from a finished 2D context, with the filtering a full-screen or
 * near-full-screen quad wants.
 *
 * Mipmaps off and `LinearFilter` on both ends: every one of these is drawn at
 * or above its own resolution, so a mip chain would be memory spent to make
 * things blurrier. `ClampToEdgeWrapping` because a soft sprite that wraps puts
 * its own falloff back on the opposite edge as a hard line.
 */
function textureOf(ctx: CanvasRenderingContext2D | null, data = false): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(
    (ctx?.canvas ?? undefined) as unknown as HTMLCanvasElement
  );
  texture.colorSpace = data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return own(texture);
}

// ---------------------------------------------------------------------------
// the brand assets, and the light they throw
// ---------------------------------------------------------------------------

export type BrandSource = HTMLImageElement | HTMLCanvasElement;

/** The artwork itself, at whatever resolution the caller resampled it to. */
export function artworkTexture(source: BrandSource): THREE.Texture {
  const texture = new THREE.Texture(source);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return own(texture);
}

/**
 * The artwork blurred, for the additive halo layer.
 *
 * `sigma` is a fraction of the artwork's longest side rather than a pixel count,
 * so the tight halo stays tight and the wide one stays wide whichever resolution
 * the master was resampled to. The canvas is padded by three sigma on every side
 * because a blur that runs into the edge of its own bitmap clips the halo square
 * — which is the exact tell this function exists to avoid.
 *
 * `ctx.filter` is a Chromium/Firefox/Safari-17 feature and there is no polyfill
 * worth writing here: when it is missing the halo falls back to a stack of
 * offset draws, which is coarser and, at 12% opacity behind a logo, entirely
 * good enough. It is decoration for decoration.
 */
/**
 * The longest side a bloom copy is ever generated at.
 *
 * A halo is a blurred picture and a blurred picture has no high frequencies in
 * it, so generating one at the artwork's own resolution is spending a very large
 * amount of work to produce detail that the blur then removes. Measured: the
 * wordmark's wide halo at full size meant a 78-pixel Gaussian over a 2516×1151
 * canvas, and the five bloom copies together cost **~450ms of blocked main
 * thread** at the exact moment the game is building the screen underneath —
 * 5 frames over 33ms and a 253ms stall in the frame log.
 *
 * At 320px the same halo is a 12-pixel blur over a 393×164 canvas, roughly
 * fifty times less work, and drawn back at full size it is pixel-for-pixel
 * indistinguishable: it is being magnified by a factor of six either way, and
 * bilinear magnification of an already-Gaussian field is another Gaussian.
 */
const BLOOM_SOURCE_PX = 320;

export function bloomOf(source: BrandSource, sigmaFraction: number): {
  texture: THREE.Texture;
  /** How much larger the padded bitmap is than the artwork, as a multiplier. */
  scale: number;
} | null {
  const longest = Math.max(source.width, source.height);
  if (!longest) return null;
  const shrink = Math.min(1, BLOOM_SOURCE_PX / longest);
  const width = Math.max(1, Math.round(source.width * shrink));
  const height = Math.max(1, Math.round(source.height * shrink));

  const sigma = Math.max(1, Math.round(Math.max(width, height) * sigmaFraction));
  const pad = sigma * 3;
  const ctx = canvas(width + pad * 2, height + pad * 2);
  if (!ctx) return null;

  // `"filter" in ctx` would be the obvious probe and TypeScript narrows the
  // else branch of it to `never` — the property is declared, so as far as the
  // type system is concerned it is always there. Asking what it *is* tests the
  // same thing at runtime without claiming anything at compile time.
  const supportsFilter = typeof ctx.filter === "string";
  if (supportsFilter) {
    ctx.filter = `blur(${sigma}px)`;
    ctx.drawImage(source, pad, pad, width, height);
    ctx.filter = "none";
  } else {
    // Eight offset draws on a ring of radius sigma, plus the centre. Crude, and
    // indistinguishable from a Gaussian once it is a halo at 12%.
    ctx.globalAlpha = 1 / 9;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      ctx.drawImage(source, pad + Math.cos(angle) * sigma, pad + Math.sin(angle) * sigma, width, height);
    }
    ctx.drawImage(source, pad, pad, width, height);
    ctx.globalAlpha = 1;
  }

  return {
    texture: textureOf(ctx),
    scale: (width + pad * 2) / width,
  };
}

/**
 * The brand artwork, lit — a 315 degree key across the plate, a rim on the lit
 * edge, a lip on the unlit one, and grain.
 *
 * ## Why the largest object in the game was the flattest
 *
 * Photographed at the camera push, the mark fills about 400 of 900 pixels and
 * was, at that size, **a two-colour pink rounded rectangle with a hard black HB
 * knocked out of it**: no bevel, no rim, no inner shadow, no specular, no
 * material and no key light — on the single most important object in the
 * domain, in the one sequence a player watches with nothing else to look at.
 * Everything else in HYPEBOUND gets §1's treatment from `foundation.css` and
 * `texture.ts`; the logo was exempt because it arrives as a PNG and a PNG looks
 * finished.
 *
 * It is not finished, it is *unlit*. Hearthstone's logo is carved metal with a
 * highlight moving across it. This applies the same recipe every other surface
 * in the game already gets, to the artwork the artist actually drew:
 *
 *  - **The key.** One gradient corner to corner — the same 315 degrees as
 *    `--light-sweep`, and the same direction the reveal wipe travels — clipped
 *    to the artwork's own alpha with `source-atop`, so a transparent surround
 *    and a knocked-out letterform stay exactly as transparent as they were.
 *  - **The rim and the lip.** The alpha, minus a copy of itself pushed a few
 *    pixels down-right, is precisely the set of edges facing the light; the
 *    opposite offset is precisely the set facing away. White on the first, near
 *    black on the second, and a flat plate becomes an object with a thickness.
 *    No edge detection, no artwork-specific numbers, nothing that stops working
 *    when the mark is redrawn.
 *  - **Grain**, at 4%, because §1 bans a mathematically smooth surface and the
 *    largest one in the game should not be the exception.
 *
 * The specular sweep is not here: `stage.ts` already crosses both lockup halves
 * with clipped additive copies on the impact beat, and it needs the *unlit*
 * artwork to do it, so `setMark` keeps the raw texture for the sheens and the
 * blooms and only swaps the plate itself.
 *
 * Returns `null` rather than throwing on a zero-sized source or a canvas that
 * will not give up a context; every caller already has a raw-artwork fallback,
 * and an unlit logo is a worse logo rather than a broken one.
 */
export function litBrandTexture(
  source: BrandSource,
  options: { key?: number; shade?: number; rim?: number; lip?: number; grain?: number } = {}
): THREE.Texture | null {
  const w = source.width;
  const h = source.height;
  if (!w || !h) return null;
  const ctx = canvas(w, h);
  if (!ctx) return null;

  ctx.drawImage(source, 0, 0, w, h);

  /**
   * How wide the bevel is, as a fraction of the longest side.
   *
   * Proportional rather than absolute so the mark and the wordmark — 2048 and
   * 3072 pixels across their masters, resampled to 1024 before they ever reach
   * here — get an edge of the same *optical* weight, and so that a future
   * redraw at another resolution needs no second number.
   */
  const edge = Math.max(1, Math.round(Math.max(w, h) * 0.007));

  // --- the key ---------------------------------------------------------------
  ctx.save();
  ctx.globalCompositeOperation = "source-atop";
  const key = ctx.createLinearGradient(0, 0, w, h);
  key.addColorStop(0, `rgba(255, 255, 255, ${options.key ?? 0.22})`);
  key.addColorStop(0.42, "rgba(255, 255, 255, 0)");
  key.addColorStop(0.58, "rgba(0, 0, 0, 0)");
  key.addColorStop(1, `rgba(8, 4, 18, ${options.shade ?? 0.3})`);
  ctx.fillStyle = key;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // --- the rim and the lip ---------------------------------------------------
  const bevel = (dx: number, dy: number, colour: string, alpha: number): void => {
    if (alpha <= 0) return;
    const cut = canvas(w, h);
    if (!cut) return;
    cut.drawImage(source, 0, 0, w, h);
    // Everything the shifted copy also covers is interior; what survives is the
    // band of edge facing (-dx, -dy).
    cut.globalCompositeOperation = "destination-out";
    cut.drawImage(source, dx, dy, w, h);
    cut.globalCompositeOperation = "source-in";
    cut.fillStyle = colour;
    cut.fillRect(0, 0, w, h);
    ctx.save();
    ctx.globalCompositeOperation = "source-atop";
    ctx.globalAlpha = alpha;
    ctx.drawImage(cut.canvas, 0, 0);
    ctx.restore();
  };
  bevel(edge, edge, "#ffffff", options.rim ?? 0.5);
  bevel(-edge, -edge, "#050210", options.lip ?? 0.42);

  // --- the dirt --------------------------------------------------------------
  const grain = options.grain ?? 0.04;
  if (grain > 0) {
    const tile = canvas(64, 64);
    if (tile) {
      const noise = tile.createImageData(64, 64);
      for (let i = 0; i < noise.data.length; i += 4) {
        const v = 110 + Math.round(Math.random() * 90);
        noise.data[i] = v;
        noise.data[i + 1] = v;
        noise.data[i + 2] = v;
        noise.data[i + 3] = 255;
      }
      tile.putImageData(noise, 0, 0);
      const pattern = ctx.createPattern(tile.canvas, "repeat");
      if (pattern) {
        ctx.save();
        ctx.globalCompositeOperation = "source-atop";
        ctx.globalAlpha = grain;
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
    }
  }

  const texture = new THREE.CanvasTexture(ctx.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return own(texture);
}

// ---------------------------------------------------------------------------
// the room
// ---------------------------------------------------------------------------

/** Where the floor meets the room, as a fraction of the backdrop's height. */
export const HORIZON = 0.7;

/**
 * The opaque backdrop: a room with a floor in it, painted once.
 *
 * The first version of this was four overlapping radial blobs and it produced a
 * purple nebula. Photographed and squinted at, AAA bar §6's test failed outright
 * — no light masses, no dark masses, the top of the frame at the same value as
 * the bottom and the logo sitting in the middle of it like a sticker. The fault
 * was not the colours. It was that a room with no floor is not a room, and
 * without a horizon there is nothing for a value structure to be *about*.
 *
 * So the wash is built as an interior:
 *
 * - a near-black ceiling, so the top of the frame is the darkest thing on screen
 * - the key light, upper left, where the foundation contract says every key
 *   light in this game lives — 315°, and a title card is not exempt
 * - a **horizon band**: a tight, hot strip of city glow two thirds down, which
 *   is where all the saturation in the picture is spent
 * - below it, a floor: much darker, carrying a soft vertical smear of the band's
 *   own colour, which is the wet-floor reflection every neon street has
 *
 * Squinted at, that resolves into three masses — dark ceiling, bright band, dark
 * floor — and the lockup then sits *against* the band instead of floating in an
 * even field. It is the same `RoomLight` the lobby is lit by, so it is still the
 * same building.
 *
 * Painted at 512×512 and stretched. There is nothing in it above about six
 * cycles per screen, so resolution buys nothing; what it would buy is a
 * multi-megabyte upload on the one frame where a player is waiting for a game
 * to start.
 */
export function washTexture(room: RoomLight): THREE.Texture {
  const w = 512;
  const h = 512;
  const ctx = canvas(w, h);
  if (!ctx) return textureOf(null);
  const horizonY = h * HORIZON;
  const strength = room.intensity;

  // 1. The shell: dark, darker at the ceiling, darkest at the floor's far edge.
  const shell = ctx.createLinearGradient(0, 0, 0, h);
  shell.addColorStop(0, "#04020c");
  shell.addColorStop(0.42, "#0a0620");
  shell.addColorStop(HORIZON - 0.02, "#160c33");
  shell.addColorStop(HORIZON + 0.02, "#0a0518");
  shell.addColorStop(1, "#030109");
  ctx.fillStyle = shell;
  ctx.fillRect(0, 0, w, h);

  const blob = (x: number, y: number, rx: number, ry: number, colour: string, alpha: number): void => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    gradient.addColorStop(0, hexToRgba(colour, alpha));
    gradient.addColorStop(0.4, hexToRgba(colour, alpha * 0.34));
    gradient.addColorStop(1, hexToRgba(colour, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(-w, -h, w * 2, h * 2);
    ctx.restore();
  };

  // 2. The key, where the room says it is. Upper left, always.
  const keyX = (parseFloat(room.keyAt[0]) / 100) * w;
  const keyY = (parseFloat(room.keyAt[1]) / 100) * h;
  blob(keyX, keyY, w * 0.62, h * 0.5, room.key, 0.4 * strength);
  // 3. The fill, thrown from the far side and always duller than the key.
  blob(w * 0.9, h * 0.2, w * 0.5, h * 0.42, room.fill, 0.2 * strength);

  /**
   * 4. The band. Wide and very flat, so it reads as distance rather than as a
   * lamp — a city seen through haze is a horizontal smear, and the moment it
   * becomes circular it becomes a sun.
   */
  blob(w * 0.42, horizonY, w * 0.95, h * 0.1, room.rim, 0.34 * strength);
  blob(w * 0.66, horizonY - h * 0.01, w * 0.66, h * 0.055, room.fill, 0.36 * strength);
  blob(w * 0.2, horizonY, w * 0.5, h * 0.045, room.key, 0.34 * strength);

  // 5. The floor: the band again, smeared downward and dying quickly.
  const wet = ctx.createLinearGradient(0, horizonY, 0, h);
  wet.addColorStop(0, hexToRgba(room.fill, 0.2 * strength));
  wet.addColorStop(0.22, hexToRgba(room.key, 0.075 * strength));
  wet.addColorStop(1, hexToRgba(room.rim, 0));
  ctx.fillStyle = wet;
  ctx.fillRect(0, horizonY, w, h - horizonY);

  /**
   * 6. The horizon line itself, one texel of it.
   *
   * A gradient meeting a gradient is a soft transition and reads as fog. Real
   * distance has a *line* in it somewhere — the far edge of the floor — and a
   * single bright hairline is the cheapest possible version of one. Without it
   * the eye has nothing to focus on and the whole lower half goes soft.
   */
  const line = ctx.createLinearGradient(0, 0, w, 0);
  line.addColorStop(0, hexToRgba(room.key, 0));
  line.addColorStop(0.3, hexToRgba(room.key, 0.34 * strength));
  line.addColorStop(0.62, hexToRgba(room.fill, 0.44 * strength));
  line.addColorStop(1, hexToRgba(room.rim, 0));
  ctx.fillStyle = line;
  ctx.fillRect(0, horizonY - 1, w, 2);

  return textureOf(ctx);
}

// ---------------------------------------------------------------------------
// light
// ---------------------------------------------------------------------------

/**
 * One shaft of light through haze: bright along its spine, gone at both ends.
 *
 * The cross-section is a squared falloff rather than a linear one because a
 * linear ramp across a wide quad reads as a painted triangle. The length
 * profile fades at the source too, not only at the far end — a shaft that
 * starts at full brightness has a visible flat top where the quad begins, and
 * every real beam in a smoky room is already spreading by the time you can see
 * it.
 */
export function beamTexture(): THREE.Texture {
  const w = 64;
  const h = 512;
  const ctx = canvas(w, h);
  if (!ctx) return textureOf(null);
  const image = ctx.createImageData(w, h);
  const pixels = image.data;

  for (let y = 0; y < h; y++) {
    const along = (y + 0.5) / h;
    // Emerges over the first 12%, dies away over the last 55%.
    const head = Math.min(1, along / 0.12);
    const tail = Math.min(1, (1 - along) / 0.55);
    /**
     * Gobo breakup: three incommensurate sines along the shaft's length.
     *
     * A beam whose only variation is a smooth falloff is a painted triangle, and
     * that is what these photographed as next to a hard-edged skyline — the one
     * mathematically perfect object in a frame full of texture. Light through
     * real smoke is *unevenly* obstructed: the smoke is denser here than there,
     * something in the rig cuts a slat out of it, dust drifts through. Three
     * frequencies at ±14% total is invisible as a pattern and is the difference
     * between a shaft of light and a wedge of colour.
     *
     * Along the length rather than across the width, deliberately. Breaking up
     * the cross-section would destroy the hot core the beam reads by; breaking
     * up the length leaves the silhouette intact and only varies its density.
     */
    const gobo =
      1 +
      0.08 * Math.sin(along * 23.7) +
      0.04 * Math.sin(along * 61.3 + 1.9) +
      0.05 * Math.sin(along * 9.1 + 4.2);
    const length = head * tail * tail * gobo;
    for (let x = 0; x < w; x++) {
      const across = Math.abs((x + 0.5) / w - 0.5) * 2;
      /**
       * A hot core inside a wide skirt, rather than one smooth falloff.
       *
       * A single power curve across the width gives a shaft with no edge: it is
       * brightest in the middle and dims evenly outward, which photographs as a
       * smear of cloud. A real beam in smoke has a definite bright centre with a
       * much fainter spill around it, and the ratio between the two is what
       * makes it read as a beam at all. `^9` is the core; `^2.2` at a fifth
       * strength is the spill.
       */
      const core = (1 - across) ** 9 + 0.42 * (1 - across) ** 2.4;
      const value = Math.round(Math.min(1, core * length) * 255);
      const p = (y * w + x) * 4;
      pixels[p] = 255;
      pixels[p + 1] = 255;
      pixels[p + 2] = 255;
      pixels[p + 3] = value;
    }
  }
  ctx.putImageData(image, 0, 0);
  return textureOf(ctx);
}

/**
 * An out-of-focus point of light.
 *
 * Not a Gaussian. A real lens renders a point source as a *disc* with a slightly
 * brighter edge — the aperture, defocused — and that ring is most of why bokeh
 * reads as photography rather than as a blurred dot. The profile below is flat
 * to 62%, lifts by a fifth at the rim, then falls off; at 64px across it costs
 * nothing and it is the single cheapest thing in this file that makes the
 * backdrop look photographed.
 */
export function bokehTexture(): THREE.Texture {
  const size = 64;
  const ctx = canvas(size, size);
  if (!ctx) return textureOf(null);
  const image = ctx.createImageData(size, size);
  const pixels = image.data;
  const centre = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x + 0.5 - centre, y + 0.5 - centre) / centre;
      /**
       * Low, and with a long tail. The first version of this ran at 0.58 across
       * a flat disc and photographed as a field of coloured poker chips: at
       * additive blending a flat 58% disc has a hard silhouette, and forty hard
       * silhouettes are confetti. A defocused highlight is mostly *soft*, and
       * the aperture ring only ever shows on the largest ones.
       */
      let value: number;
      if (r >= 1) value = 0;
      else if (r < 0.42) value = 0.13;
      else if (r < 0.68) value = 0.13 + 0.07 * ((r - 0.42) / 0.26);
      else value = 0.2 * (1 - (r - 0.68) / 0.32) ** 2.4;
      const p = (y * size + x) * 4;
      pixels[p] = 255;
      pixels[p + 1] = 255;
      pixels[p + 2] = 255;
      pixels[p + 3] = Math.round(Math.max(0, Math.min(1, value)) * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  return textureOf(ctx);
}

/** A soft round haze puff. Several of these at low alpha are a volume. */
export function hazeTexture(): THREE.Texture {
  const size = 256;
  const ctx = canvas(size, size);
  if (!ctx) return textureOf(null);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,0.5)");
  gradient.addColorStop(0.32, "rgba(255,255,255,0.22)");
  gradient.addColorStop(0.68, "rgba(255,255,255,0.05)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return textureOf(ctx);
}

/**
 * The shockwave the mark throws when it lands: a thin annulus, soft on both
 * sides, thicker on the leading edge than the trailing one.
 *
 * Asymmetric on purpose. A symmetric ring expands like a ripple in water; a ring
 * whose inner edge trails away over three times the distance of its outer edge
 * expands like a pressure front, which is what a heavy object hitting a floor
 * full of smoke actually does.
 */
export function ringTexture(): THREE.Texture {
  // 256 rather than 512: this is drawn at a couple of hundred pixels across and
  // its sharpest feature is a soft annulus a fifth of the radius wide, so the
  // extra 200,000 `hypot` calls at boot buy nothing anybody can see.
  const size = 256;
  const ctx = canvas(size, size);
  if (!ctx) return textureOf(null);
  const image = ctx.createImageData(size, size);
  const pixels = image.data;
  const centre = size / 2;
  const at = 0.78;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x + 0.5 - centre, y + 0.5 - centre) / centre;
      const d = r - at;
      const value = d >= 0 ? Math.max(0, 1 - d / 0.19) ** 2.2 : Math.max(0, 1 + d / 0.56) ** 3.4;
      const p = (y * size + x) * 4;
      pixels[p] = 255;
      pixels[p + 1] = 255;
      pixels[p + 2] = 255;
      pixels[p + 3] = Math.round(Math.max(0, Math.min(1, value)) * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  return textureOf(ctx);
}

// ---------------------------------------------------------------------------
// the place
// ---------------------------------------------------------------------------

/**
 * A city block, generated: silhouette, lit windows, roof signage, and the wet
 * street the whole thing is standing in.
 *
 * This function exists because of the one thing the first version of the title
 * sequence did not have, and could not fake with light alone: **a place.** The
 * room was a wash, five shafts, a haze puff and a field of defocused points,
 * and photographed at 700ms — the establishing beat, the frame that has to tell
 * a stranger what kind of game this is — it was two diagonal streaks over a
 * purple gradient. Every element in it was a soft radial falloff. There was
 * nothing on screen with an *edge*, so there was nothing for the eye to read as
 * an object, a distance or a scale, and "neon nightlife" was a claim the
 * pictures did not support.
 *
 * A silhouette fixes that in one move, and it is the cheapest fix available:
 * hard-edged geometry is the only thing in a hazy frame that establishes where
 * the camera is standing. Hearthstone's menu does it with a building; Gwent does
 * it with a horizon of trees. Here it is a skyline, because the game is set in a
 * city at night and that is what a city at night looks like from the street.
 *
 * ## Two bitmaps, because the lights have a second job
 *
 * The towers are painted twice: once as opaque mass and once as emission only.
 * That is not tidiness. The wet street below the horizon is *the same lights*,
 * flipped and smeared downward — a neon reflection in wet asphalt is a vertical
 * streak of the sign above it, broken by ripples, and it is by some distance the
 * strongest single cue that a scene is a rainy street at night rather than a
 * lit room. Keeping the emissive pass separate is what makes that free: the
 * reflection is the same paint, transformed, so the two can never disagree about
 * which windows are on.
 *
 * ## Atmospheric perspective is applied to the alpha, not the colour
 *
 * The bases of the towers are lifted toward the horizon glow and their tops are
 * not, which is what distance through haze does. Doing it as a `source-atop`
 * fill means the fog only ever touches painted pixels, so the roofline stays a
 * hard silhouette against the sky while the ground floor dissolves into the band
 * — a skyline whose fog is painted over the sky as well has a visible rectangle
 * around it, which is the failure this ordering avoids.
 */
export interface CitySpec {
  seed: number;
  /** Texture width in pixels. Height follows from `aspect`. */
  px: number;
  /** Width ÷ height of the band. Far bands are long and low. */
  aspect: number;
  towers: number;
  /** Roofline range, as fractions of the band's height. */
  low: number;
  high: number;
  /** Silhouette ink. A near band is nearly black; a far one is lifted by haze. */
  ink: string;
  /** How far the horizon glow lifts the base of the silhouette, 0–1. */
  fog: number;
  fogColour: string;
  /** Chance that a window cell is lit. */
  lit: number;
  /** Window cell size in texture pixels. */
  cell: number;
}

export interface CityBand {
  /** The skyline itself: silhouette with its own lights burned in. */
  mass: THREE.Texture;
  /** The lights only, flipped and smeared — the street below the horizon. */
  wet: THREE.Texture;
  aspect: number;
  wetAspect: number;
}

/** How far down the reflection reaches, as a multiple of the band's height. */
const WET_REACH = 0.85;

export function cityTexture(spec: CitySpec): CityBand | null {
  const w = spec.px;
  const h = Math.round(spec.px / spec.aspect);
  const mass = canvas(w, h);
  const lights = canvas(w, h);
  if (!mass || !lights) return null;

  let state = (spec.seed * 2654435761) >>> 0;
  const rand = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const between = (a: number, b: number): number => a + (b - a) * rand();

  /**
   * Towers are laid out right-to-left as well as left-to-right, alternately,
   * from a cursor that is allowed to run backwards.
   *
   * A single left-to-right sweep produces a roofline whose heights are
   * independent samples, and independent samples read as noise: the eye sees a
   * bar chart. Real skylines cluster — a tall block has taller neighbours,
   * because that is where the zoning and the money are. `cluster` is a slow
   * random walk that biases the height of each tower toward its neighbour's, and
   * it is the difference between a skyline and a histogram.
   */
  let cluster = 0.5;
  let x = -w * 0.04;
  const step = (w * 1.08) / spec.towers;
  /** Occasionally the walk slams to an extreme: a district, or a tower. */
  const jolt = (): number => (rand() > 0.86 ? (rand() > 0.5 ? 1 : 0) : cluster);

  interface Tower {
    x: number;
    w: number;
    top: number;
    tint: number;
  }
  const towers: Tower[] = [];
  while (x < w && towers.length < spec.towers * 2) {
    cluster = Math.min(1, Math.max(0, jolt() + between(-0.26, 0.26)));
    const width = step * between(0.5, 1.5);
    /**
     * The exponent, and why the roofline needed one.
     *
     * A linear map from the cluster walk to a height gives a roofline whose
     * blocks are all within about twenty percent of each other — a wall with a
     * ragged top, not a skyline. What makes a skyline a silhouette is that most
     * of it is low and a *few* things are very tall, so the eye has two or three
     * landmarks to hang the shape on. Squaring the sample does exactly that:
     * it pushes the bulk down and leaves the extremes where they were.
     */
    const height = h * (spec.low + (spec.high - spec.low) * (cluster * 0.86 + rand() * 0.14) ** 2);
    towers.push({ x, w: width, top: h - height, tint: Math.floor(rand() * NIGHTLIFE_COUNT) });
    // Overlap slightly more often than they gap, so blocks read as a mass with
    // a broken top edge rather than as a row of separated posts.
    x += width * between(0.62, 1.05);
  }

  /**
   * The window palette, and the single mistake that made the first attempt look
   * like an arcade game.
   *
   * Picking each window straight out of the seven Currents at full saturation
   * gives a facade speckled orange, cyan, red and lime in equal measure — which
   * is not a city at night, it is a colour swatch. Photograph any real skyline
   * and the overwhelming majority of the lit windows are one of two colours,
   * warm tungsten or cool fluorescent, because that is what is inside buildings;
   * the saturated hues are *signage*, and there are perhaps five of those in
   * shot.
   *
   * So the ordinary window is a Current mixed most of the way to one of those
   * two neutrals — enough that the frame is still lit by this game's palette,
   * nowhere near enough to read as a colour. One window in eleven keeps its full
   * `hi` value, and those are the ones the eye picks out.
   */
  const WARM = [255, 226, 178];
  const COOL = [196, 220, 255];
  const windowInk: string[] = [];
  for (let i = 0; i < 24; i++) {
    const base = CURRENT_PALETTE[NIGHTLIFE[i % NIGHTLIFE.length]!].key;
    const towardCool = i % 3 === 0;
    const neutral = towardCool ? COOL : WARM;
    const r = parseInt(base.slice(1, 3), 16);
    const g = parseInt(base.slice(3, 5), 16);
    const b = parseInt(base.slice(5, 7), 16);
    const m = 0.62 + (i % 5) * 0.05;
    windowInk.push(
      `rgb(${Math.round(r + (neutral[0]! - r) * m)},${Math.round(g + (neutral[1]! - g) * m)},${Math.round(
        b + (neutral[2]! - b) * m
      )})`
    );
  }

  lights.globalCompositeOperation = "lighter";

  for (const tower of towers) {
    /**
     * The facade is a gradient, not a fill.
     *
     * A flat silhouette is correct for something genuinely backlit and wrong for
     * a building, whose glass picks up the sky at the top and is in shadow at the
     * street. Two stops of about eight percent is invisible as a gradient and is
     * the difference between a cut-out and a surface — the same argument §1
     * makes about every panel in the game, applied to the one object in this
     * frame that has a flat side facing the camera.
     */
    const face = mass.createLinearGradient(0, tower.top, 0, h);
    face.addColorStop(0, hexToRgba(spec.ink, 1));
    face.addColorStop(1, "rgba(2,1,6,1)");
    mass.fillStyle = face;
    mass.fillRect(tower.x, tower.top, tower.w, h - tower.top);

    // A stepped setback on the taller blocks, and a mast on a few of those.
    if (tower.w > step * 0.8 && rand() > 0.55) {
      const capW = tower.w * between(0.4, 0.72);
      const capH = h * between(0.03, 0.08);
      mass.fillStyle = hexToRgba(spec.ink, 1);
      mass.fillRect(tower.x + (tower.w - capW) / 2, tower.top - capH, capW, capH);
      if (rand() > 0.62) {
        const mastH = h * between(0.05, 0.14);
        const mastX = Math.round(tower.x + tower.w / 2);
        mass.fillRect(mastX, tower.top - capH - mastH, Math.max(1, w * 0.0006), mastH);
        // The aviation beacon. One warm dot at the top of one mast in three is
        // the detail that makes a silhouette read as architecture.
        const beacon = CURRENT_PALETTE["cinder"].hi;
        lights.fillStyle = hexToRgba(beacon, 0.75);
        const r = Math.max(1, w * 0.0011);
        lights.beginPath();
        lights.arc(mastX, tower.top - capH - mastH, r, 0, Math.PI * 2);
        lights.fill();
      }
    }

    /**
     * Windows, by floor rather than by cell.
     *
     * Occupancy is not independent per window — a floor is lit or it is not, and
     * within a lit floor most of the windows are on. Rolling a per-storey
     * multiplier before the row is what gives a facade its horizontal banding,
     * and banding is most of what makes a grid of dots read as a building
     * instead of as static.
     */
    const cell = spec.cell;
    const phase = rand() * cell;
    for (let wy = tower.top + cell * 1.2; wy < h - cell * 0.6; wy += cell) {
      const storey = spec.lit * (rand() > 0.68 ? 0.15 : between(0.75, 1.35));
      for (let wx = tower.x + phase + cell * 0.35; wx < tower.x + tower.w - cell * 0.6; wx += cell) {
        if (rand() > storey) continue;
        const hot = rand() > 0.91;
        if (hot) {
          const accent = CURRENT_PALETTE[NIGHTLIFE[(tower.tint + 1) % NIGHTLIFE.length]!];
          lights.fillStyle = hexToRgba(accent.hi, between(0.55, 0.95));
        } else {
          lights.fillStyle = windowInk[(tower.tint * 5 + Math.floor(wy)) % windowInk.length]!;
          lights.globalAlpha = between(0.16, 0.5);
        }
        lights.fillRect(wx, wy, cell * 0.4, cell * 0.34);
        lights.globalAlpha = 1;
      }
    }

    /**
     * A rooftop sign on one block in nine, drawn as a bar rather than as text.
     *
     * Legible signage would be a lie — there is no such shop — and it would also
     * be the one element in the frame with a reading age. A bright bar at this
     * size is exactly what a sign looks like from three streets away, which is
     * where the camera is standing.
     */
    if (rand() > 0.89) {
      const signW = tower.w * between(0.2, 0.42);
      const signH = Math.max(1.2, h * between(0.006, 0.011));
      const signX = tower.x + (tower.w - signW) / 2;
      const signY = tower.top + h * between(0.03, 0.1);
      const sign = CURRENT_PALETTE[NIGHTLIFE[(tower.tint + 2) % NIGHTLIFE.length]!];
      /**
       * The halo is a canvas shadow, not a second rectangle.
       *
       * The first version drew a larger flat rectangle behind the bar at 16% and
       * it read as exactly that: a pale box around a white box, the single most
       * obviously computer-generated thing in the frame. A neon sign's glow has
       * the shape of the sign and no edge at all, and `shadowBlur` is the one
       * canvas primitive that gives that for free.
       */
      lights.save();
      lights.shadowColor = hexToRgba(sign.key, 0.85);
      lights.shadowBlur = signH * 7;
      lights.fillStyle = hexToRgba(sign.key, 0.62);
      lights.fillRect(signX, signY, signW, signH);
      lights.shadowBlur = signH * 2.5;
      lights.fillStyle = hexToRgba(sign.hi, 0.7);
      lights.fillRect(signX, signY + signH * 0.25, signW, signH * 0.5);
      lights.restore();
    }

    // A vertical neon strip up one edge of the occasional block. Short, because
    // a full-height one reads as scaffolding rather than as a sign.
    if (rand() > 0.9) {
      const strip = CURRENT_PALETTE[NIGHTLIFE[(tower.tint + 4) % NIGHTLIFE.length]!];
      const stripH = (h - tower.top) * between(0.3, 0.6);
      lights.fillStyle = hexToRgba(strip.key, 0.45);
      lights.fillRect(
        tower.x + tower.w * (rand() > 0.5 ? 0.08 : 0.88),
        tower.top + h * 0.03,
        Math.max(1, w * 0.0009),
        stripH
      );
    }
  }

  /**
   * Street level: a hot band along the very bottom, brighter than anything
   * above it.
   *
   * The ground is where the signs, the windows of the bars and the headlights
   * all are, and a skyline whose brightest pixels are at the top has the value
   * structure of a sunrise. Squinted at, §6's test wants light and dark masses:
   * this is the light one, and it sits directly under the logo.
   */
  lights.globalCompositeOperation = "source-over";

  // Haze, on the painted pixels only. See the note above about `source-atop`.
  mass.globalCompositeOperation = "source-atop";
  const fog = mass.createLinearGradient(0, h, 0, 0);
  fog.addColorStop(0, hexToRgba(spec.fogColour, spec.fog));
  fog.addColorStop(0.45, hexToRgba(spec.fogColour, spec.fog * 0.4));
  fog.addColorStop(1, hexToRgba(spec.fogColour, 0));
  mass.fillStyle = fog;
  mass.fillRect(0, 0, w, h);
  mass.globalCompositeOperation = "lighter";
  mass.drawImage(lights.canvas, 0, 0);
  /**
   * Street level: a hot band along the very bottom, added to the mass and
   * deliberately *not* to the emissive pass.
   *
   * The ground is where the signs, the bar windows and the headlights are, and a
   * skyline whose brightest pixels are at the top has the value structure of a
   * sunrise. Squinted at, §6 wants light and dark masses; this is the light one,
   * and it sits directly under the logo.
   *
   * It is kept out of `lights` because `lights` is also the source for the
   * reflection, and a smooth gradient smeared twenty-six times is a smooth
   * gradient — it drowned every window in the wet pass and turned a street into
   * a lavender fog bank. The reflection gets its own, tighter spill below.
   */
  const street = mass.createLinearGradient(0, h, 0, h * 0.74);
  street.addColorStop(0, hexToRgba(spec.fogColour, 0.26));
  street.addColorStop(0.4, hexToRgba(spec.fogColour, 0.08));
  street.addColorStop(1, hexToRgba(spec.fogColour, 0));
  mass.fillStyle = street;
  mass.fillRect(0, h * 0.74, w, h * 0.26);
  mass.globalCompositeOperation = "source-over";

  /**
   * The wet street.
   *
   * Sixteen copies of the emissive pass, flipped, each one further down and
   * fainter than the last, is a vertical motion blur done with `drawImage` — and
   * a vertical motion blur of a neon sign *is* its reflection in wet ground.
   * Sixteen rather than four because the banding is findable at four; rather
   * than sixty-four because at this alpha it is not findable at sixteen.
   *
   * Then the ripples, punched out with `destination-out` along a sum of two
   * incommensurate sines: still water gives a mirror, and a mirror of a skyline
   * on a street is a puddle the size of a district. Broken horizontally into
   * bands, it is a wet road.
   */
  const wetH = Math.round(h * WET_REACH);
  const smear = canvas(w, wetH);
  if (!smear) return null;
  smear.globalCompositeOperation = "lighter";
  smear.save();
  smear.scale(1, -1);
  /**
   * A *short* smear, and the length of it is the whole difference between a
   * reflection and a fog bank.
   *
   * The first version dragged each copy the full height of the band, which
   * means every row of the result is the average of twenty-six different rows
   * of the skyline — and the average of a skyline is a flat wash. It rendered as
   * a smooth lavender gradient with no structure in it at all, which is exactly
   * what it should have been: that is what averaging does. Eighteen percent of
   * the band keeps each light's own column recognisable while still turning it
   * into a streak, and it is the amount a real wet road actually smears at this
   * distance.
   */
  const SMEAR = 22;
  const REACH = wetH * 0.18;
  for (let i = 0; i < SMEAR; i++) {
    const t = i / SMEAR;
    smear.globalAlpha = (1 - t) ** 0.9 * 0.22;
    smear.drawImage(lights.canvas, Math.sin(i * 2.3) * w * 0.0012, -h + t * REACH, w, h);
  }
  smear.restore();
  smear.globalAlpha = 1;

  /**
   * The spill: the glow the whole city throws onto the ground nearest it.
   *
   * Separate from the streaks because it is a different phenomenon — the streaks
   * are specular reflections of individual sources and this is the diffuse
   * scatter of all of them together. Without it the reflection starts abruptly
   * at the horizon; with it the ground under the far lights is simply brighter,
   * which is what standing in a lit street looks like.
   */
  smear.globalCompositeOperation = "lighter";
  const spill = smear.createLinearGradient(0, 0, 0, wetH * 0.6);
  spill.addColorStop(0, hexToRgba(spec.fogColour, 0.22));
  spill.addColorStop(0.35, hexToRgba(spec.fogColour, 0.07));
  spill.addColorStop(1, hexToRgba(spec.fogColour, 0));
  smear.fillStyle = spill;
  smear.fillRect(0, 0, w, wetH * 0.6);
  smear.globalCompositeOperation = "source-over";

  /**
   * A hard horizontal blur over the finished smear, and it is the step that
   * decides whether this reads as water or as a printing fault.
   *
   * A vertical-only smear leaves every window's own width intact, so the
   * reflection is a legible, column-accurate copy of the skyline — which is what
   * a *mirror* is. Asphalt is not a mirror; it is a rough surface with a film of
   * water on it, and it scatters horizontally as well as vertically. Blurring
   * across before the ripples go in is what turns eight hundred individual
   * windows into a dozen bands of colour, which is what the eye expects.
   */
  const wet = canvas(w, wetH);
  if (!wet) return null;
  if (typeof wet.filter === "string") wet.filter = `blur(${Math.max(1.5, w * 0.0012).toFixed(1)}px)`;
  wet.drawImage(smear.canvas, 0, 0);
  wet.filter = "none";

  /**
   * The ripples, punched out along a sum of two incommensurate sines.
   *
   * Still water gives a mirror, and a mirror of a skyline on a street is a
   * puddle the size of a district. Broken horizontally into bands, it is a wet
   * road — and the two frequencies mean the banding has no findable period,
   * which a single sine very obviously does.
   */
  wet.globalCompositeOperation = "destination-out";
  for (let y = 0; y < wetH; y++) {
    const depth = y / wetH;
    const ripple = Math.sin(y * 0.19) * 0.55 + Math.sin(y * 0.053 + 1.3) * 0.45;
    // Rougher toward the camera: the near ground breaks the reflection up more.
    const cut = Math.max(0, ripple) ** 1.4 * (0.34 + depth * 0.44);
    if (cut <= 0.01) continue;
    wet.fillStyle = `rgba(0,0,0,${cut.toFixed(3)})`;
    wet.fillRect(0, y, w, 1);
  }
  /**
   * The street is lit from 315°, like everything else, so it is not equally
   * bright across its width.
   *
   * This started as a composition fix and turned into a correctness fix. With
   * the reflection at a uniform brightness the wet band became the brightest,
   * most saturated mass in the whole frame — a horizontal bar of neon running
   * the full width, directly under the wordmark — and §6 is explicit that the
   * most saturated thing on screen should be the thing that matters most. It was
   * not; the logo was.
   *
   * Ramping it along the key axis fixes both problems with one gradient. The
   * lit side keeps its neon, the far side falls into the dark, the composition
   * gets an asymmetry it badly needed, and the picture stops having a uniformly
   * lit floor — which is the one thing no real street has.
   */
  const rake = wet.createLinearGradient(0, 0, w, 0);
  const fall = 0.46;
  /**
   * `+` and not `-`, and getting this backwards is the exact defect the
   * foundation contract says fifteen parallel builders will introduce.
   *
   * `LIGHT_RIG.screen` points *toward* the light in CSS coordinates, and at 315°
   * that is (-0.707, -0.707) — up and to the **left**. The mirror of a source at
   * up-left in a horizontal floor sits down-left, so the wet street is brightest
   * on the left of frame. The first version of this line negated it and lit the
   * right-hand side, which is a second sun in a picture that has exactly one.
   */
  const lit = 0.5 + LIGHT_RIG.screen.x * 0.5;
  // Alpha rises with distance from the specular point, so the further the
  // ground is from the light's own reflection the less of it survives.
  rake.addColorStop(0, `rgba(0,0,0,${(fall * lit).toFixed(3)})`);
  rake.addColorStop(Math.min(0.9, Math.max(0.1, lit)), "rgba(0,0,0,0.02)");
  rake.addColorStop(1, `rgba(0,0,0,${(fall * (1 - lit)).toFixed(3)})`);
  wet.fillStyle = rake;
  wet.fillRect(0, 0, w, wetH);

  // And the distance fade: the reflection dies well before the bottom of the
  // frame, because the ground gets rougher and darker as it comes toward you.
  const die = wet.createLinearGradient(0, 0, 0, wetH);
  die.addColorStop(0, "rgba(0,0,0,0)");
  die.addColorStop(0.5, "rgba(0,0,0,0.34)");
  die.addColorStop(1, "rgba(0,0,0,1)");
  wet.fillStyle = die;
  wet.fillRect(0, 0, w, wetH);
  wet.globalCompositeOperation = "source-over";

  return {
    mass: textureOf(mass),
    wet: textureOf(wet),
    aspect: spec.aspect,
    wetAspect: w / wetH,
  };
}

/**
 * The crowd, out of focus, along the bottom edge of the frame.
 *
 * The last depth plane, and the one that puts the camera *somewhere*. §2 asks
 * for four resolvable planes separated by blur and scale rather than by
 * z-index; without a foreground the title sequence had three, and every one of
 * them was behind the logo. A row of heads at the bottom of the frame, blurred
 * past recognition, does three things at once: it says the viewer is standing in
 * a crowd, it gives the reflection on the floor something to die into, and it
 * darkens the bottom of the composition so the value structure has a floor.
 *
 * Silhouette only, with one cool rim along the tops. Anything more would be a
 * character, and there are no characters in this sequence — the moment a shape
 * in a title card starts to look like a specific person, the eye tries to read
 * a face and finds a smudge.
 *
 * ## What "a floor rather than a hole" turned out to cost
 *
 * The first version was heads and a 7.5% rim and nothing else, on the argument
 * that a rim too faint to see as a highlight is still enough to stop the band
 * reading as a hole cut in the picture. Measured, it was not. Sampling the
 * settled title frame in eighteen horizontal bands put the bottom one at a mean
 * luminance of **7.6/255 with a peak of 51** — against 108 across the wordmark
 * and 90 across the wet street. That is not a dark foreground, it is the absence
 * of one: a tenth of the composition doing no work at all, in the frame the
 * whole sequence exists to arrive at.
 *
 * What fixed it is not more exposure on the silhouettes, which would only have
 * made them grey. It is that **a crowd at night is lit by the phones in it**.
 * Sixteen small screens held up over the heads put real highlights in the
 * darkest plane — bright pixels, tiny area, so the band gains contrast without
 * gaining value — and they are the one detail that makes a row of blurred domes
 * read as an audience rather than as terrain. A handful of raised arms breaks
 * the dome line for the same reason. Both are the *nightlife* premise the rest
 * of the set is already about, and neither is a character: a phone at nine
 * pixels through a four-pixel blur is a light, not a person.
 */
export function crowdTexture(): THREE.Texture {
  const w = 1024;
  const h = 200;
  const ctx = canvas(w, h);
  /**
   * Two working layers, and the reason is a measurement.
   *
   * The silhouettes used to be drawn straight into the output with
   * `ctx.filter = "blur(9px)"` standing, which means Chrome runs a separate
   * Gaussian for every primitive: at a hundred and seventy-eight heads that is
   * three hundred and fifty-six blurs, and the intro's build frame went from
   * 347ms to 547ms when the rank counts went up. One blur of a finished layer is
   * the same picture for a fiftieth of the work.
   *
   * It is also the *better* picture. Blurring each ellipse separately softens
   * every shape against its own neighbours, so overlapping heads keep visible
   * internal edges where a lens would have dissolved them into one mass. A lens
   * defocuses the assembled image, and so does this.
   */
  const mass = canvas(w, h);
  const lights = canvas(w, h);
  if (!ctx || !mass || !lights) return textureOf(null);

  let state = 0x51ed;
  const rand = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };

  const supportsFilter = typeof ctx.filter === "string";

  /**
   * Everything below is drawn squashed, because everything above it is stretched.
   *
   * `stage.ts` puts this texture on a quad `view.w * 1.15` wide and
   * `view.h * 0.145` tall. At 16:9 that is 1840 × 130 screen pixels for a
   * 1024 × 200 canvas — so a texel is **2.75 times wider than it is tall** by the
   * time anybody looks at it. Authoring in texture space therefore draws a circle
   * and displays an ellipse nearly three times as wide, and that single fact
   * accounted for every complaint about the first two versions of this band: the
   * heads read as rolling hills rather than people, the shoulders were four head-
   * widths across, and the held phones — carefully drawn portrait, 8 × 14 — came
   * out as *landscape* bars, which is a windowsill, not a phone.
   *
   * So the whole thing is drawn through one horizontal squash and authored in a
   * space where a circle stays a circle on screen. `x` still spans the full band,
   * because the virtual width is scaled to match. Nothing else in this function
   * has to think about it again.
   *
   * The blur is applied to the finished layers in device pixels, so it stays
   * isotropic in the canvas and comes out softer horizontally than vertically
   * once stretched — which is what a wide-aperture lens does to a foreground
   * anyway.
   */
  const SQUASH = 2.75;
  const vw = w * SQUASH;
  mass.setTransform(1 / SQUASH, 0, 0, 1, 0, 0);
  lights.setTransform(1 / SQUASH, 0, 0, 1, 0, 0);

  /**
   * Three ranks at three sizes, back to front, and the near rank is nearly the
   * height of the band.
   *
   * One rank of evenly-sized heads on one baseline is a caterpillar — that is
   * exactly what the first version photographed as, a regular row of identical
   * bumps with a light on each. A crowd is a *depth*: a wall of small heads
   * behind, a few very large near ones breaking the top line, and the ranks
   * overlapping enough that no single silhouette is separable. The randomness
   * that matters is in the size, not in the spacing.
   *
   * The counts went up with the squash and not because anybody wanted more
   * people: heads that are no longer stretched sideways cover a third of the
   * width they used to, so the same nine near-rank silhouettes left gaps you
   * could see the floor through.
   */
  mass.fillStyle = "#000000";
  const heads: Array<{ x: number; y: number; r: number; near: boolean }> = [];
  /*
   * The bases are where they are because only the top ~60% of this band is on
   * screen. The quad is anchored to the bottom edge of the frame and hangs a
   * little past it, so a rank sitting at 0.74 of the texture lands at screen
   * y=876 out of 900 — its heads clipped, its shoulders gone, and the only thing
   * left in the picture a flat black line. Everything is pulled up until the
   * near rank's crowns break the silhouette at about y=846, which is where the
   * edge of the mass wants to be against a wet street at y=630.
   */
  const ranks = [
    { count: 90, base: 0.44, size: 0.03, spread: 0.06 },
    { count: 58, base: 0.53, size: 0.05, spread: 0.08 },
    { count: 30, base: 0.63, size: 0.085, spread: 0.11 },
  ];
  for (const [rankIndex, rank] of ranks.entries()) {
    for (let i = 0; i < rank.count; i++) {
      const cx = (i + rand() * 1.4 - 0.2) * (vw / rank.count);
      const r = h * rank.size * (0.7 + rand() * 0.7);
      const cy = h * (rank.base + (rand() - 0.5) * rank.spread);
      heads.push({ x: cx, y: cy, r, near: rankIndex === 2 });
      mass.beginPath();
      mass.ellipse(cx, cy, r * 0.82, r, 0, 0, Math.PI * 2);
      mass.fill();
      mass.beginPath();
      mass.ellipse(cx, cy + r * 1.9, r * 1.35, r * 1.7, 0, 0, Math.PI * 2);
      mass.fill();
    }
  }
  mass.fillRect(0, h * 0.8, vw, h * 0.2);

  /**
   * Raised arms, cut from the same black as the heads.
   *
   * The top line of a crowd is the only part of it the eye reads, and a hundred
   * and seventy ellipses give it a hundred and seventy domes — a very regular
   * edge, which is the shape of a hedge rather than of people. An arm is a
   * silhouette that goes *up*, and a handful of them is the difference between a
   * mass and a mass that is doing something. Drawn from near-rank heads only, so
   * they read as the front row.
   */
  const near = heads.filter((head) => head.near);
  for (let i = 0; i < near.length; i += 4) {
    const from = near[i];
    if (!from) continue;
    const lean = (rand() - 0.5) * 0.5;
    const reach = from.r * (1.5 + rand() * 1.1);
    const wrist = from.r * 0.2;
    mass.beginPath();
    mass.moveTo(from.x - from.r * 0.5, from.y);
    mass.quadraticCurveTo(
      from.x - from.r * 0.2 + lean * reach * 0.5,
      from.y - reach * 0.6,
      from.x + lean * reach - wrist,
      from.y - reach
    );
    mass.lineTo(from.x + lean * reach + wrist, from.y - reach);
    mass.quadraticCurveTo(
      from.x + from.r * 0.5 + lean * reach * 0.5,
      from.y - reach * 0.55,
      from.x + from.r * 0.6,
      from.y
    );
    mass.closePath();
    mass.fill();
  }

  /**
   * The rim, and why it is only on the near rank and only at the top-left.
   *
   * 315°, like everything else in this game: the rig is above and to the left,
   * so the light that gets past a person catches the same side of every skull in
   * the room. The near rank gets four times what the two behind it get, because
   * the light has to fall off with distance or it is not light, it is an outline
   * — and a rim at equal strength on all a hundred and seventy heads is a row of
   * glowing beads.
   *
   * The near value was 7.5% and is now 22%, because 7.5% measured as nothing: the
   * whole point of a rim is to separate a silhouette from what is behind it, and
   * one that cannot be found by a pixel sampler is not doing that. 22% on a black
   * shape over a dark room is still a long way from a highlight — the head stays
   * a hole with an edge on it, which is what a person between you and a light
   * looks like.
   *
   * The rims are gradients rather than blurred shapes, so they need no filter of
   * their own — a radial ramp is already smooth. They go on the light layer with
   * the phones and take that layer's short blur, which softens them a shade and
   * costs nothing.
   */
  const cool = CURRENT_PALETTE["tide"].key;
  for (const head of heads) {
    const strength = head.near ? 0.22 : 0.055;
    const rim = lights.createRadialGradient(
      head.x + LIGHT_RIG.screen.x * head.r * 0.7,
      head.y + LIGHT_RIG.screen.y * head.r * 0.7,
      head.r * 0.15,
      head.x + LIGHT_RIG.screen.x * head.r * 0.7,
      head.y + LIGHT_RIG.screen.y * head.r * 0.7,
      head.r * 1.05
    );
    rim.addColorStop(0, hexToRgba(cool, strength));
    rim.addColorStop(1, hexToRgba(cool, 0));
    lights.fillStyle = rim;
    lights.beginPath();
    lights.ellipse(head.x, head.y, head.r * 1.05, head.r * 1.15, 0, 0, Math.PI * 2);
    lights.fill();
  }

  /**
   * Twenty-two phones, held up.
   *
   * Each is two draws: a hard little rectangle for the screen and a wide, weak
   * radial for the light it throws. The rectangle is what makes it a phone —
   * through the blur it survives as a bright vertical chip, and a chip is
   * unmistakably a held object where a soft dot is only a bokeh. The radial is
   * what makes it a *light*, and it is deliberately three times the size of the
   * screen and a tenth of its strength, because that is the ratio a small
   * emitter has in fog.
   *
   * Placed above the head line rather than among it — an arm's length up, in the
   * top third of the band — so they are read as belonging to the crowd without
   * being read as faces in it. Mostly tide, some halo, the odd pulse: the game's
   * own Currents, so even the furthest detail in the darkest plane is in the
   * palette every card is drawn from.
   */
  const screens = [CURRENT_PALETTE["tide"].hi, CURRENT_PALETTE["halo"].key, CURRENT_PALETTE["pulse"].hi];
  for (let i = 0; i < 22; i++) {
    const roll = rand();
    const tint = screens[roll > 0.86 ? 2 : roll > 0.68 ? 1 : 0]!;
    /*
     * A slot each, jittered by most of a slot. Twenty-two evenly spaced lights
     * is a string of fairy lights; the jitter is what lets two of them end up
     * next to each other and leave a gap somewhere else, which is what a crowd
     * does. It cannot exceed a slot, or they cross and the density stops being
     * even at the scale that matters.
     */
    const x = (i + 0.5 + (rand() - 0.5) * 1.7) * (vw / 22);
    const y = h * (0.2 + rand() * 0.19);
    const pw = 10 + rand() * 5;
    const ph = pw * (1.6 + rand() * 0.4);
    const bright = 0.5 + rand() * 0.45;

    const bloom = lights.createRadialGradient(x, y, 0, x, y, ph * 3.4);
    bloom.addColorStop(0, hexToRgba(tint, 0.1 * bright));
    bloom.addColorStop(1, hexToRgba(tint, 0));
    lights.fillStyle = bloom;
    lights.beginPath();
    lights.arc(x, y, ph * 3.4, 0, Math.PI * 2);
    lights.fill();

    lights.fillStyle = hexToRgba(tint, bright);
    lights.fillRect(x - pw / 2, y - ph / 2, pw, ph);
  }

  /**
   * Assemble: the mass defocused hard, the lights defocused a little, added.
   *
   * Two filter operations for the whole band. The lights go on with `lighter`
   * because a phone screen and the halo around it are emitters — they add to
   * whatever is behind them rather than replacing it, which is what keeps a rim
   * reading as light *getting past* a head instead of as paint on one.
   *
   * The lights get a much shorter blur than the mass. They are nearer the lens
   * than nothing — they are held by the people in the mass — but a light source
   * survives defocus as a bright core with a soft skirt, and blurring it as hard
   * as the silhouettes would flatten twenty-two phones into one grey wash.
   */
  if (supportsFilter) ctx.filter = "blur(9px)";
  ctx.drawImage(mass.canvas, 0, 0);
  if (supportsFilter) ctx.filter = "blur(2.5px)";
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(lights.canvas, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";

  return textureOf(ctx);
}

/**
 * An anamorphic streak — the horizontal blue-white smear a wide lens throws
 * across a bright highlight.
 *
 * It is one of about four visual cues that separate "rendered" from "filmed",
 * and it is nearly free: a horizontal gradient with a very tight vertical
 * falloff, drawn additively at 1% of the frame's height and forty times its
 * width. The faint cool cast in the middle is the aberration; a pure white
 * streak reads as a scratch on the lens instead.
 */
export function streakTexture(): THREE.Texture {
  const w = 1024;
  const h = 32;
  const ctx = canvas(w, h);
  if (!ctx) return textureOf(null);
  const image = ctx.createImageData(w, h);
  const pixels = image.data;

  for (let y = 0; y < h; y++) {
    const across = Math.abs((y + 0.5) / h - 0.5) * 2;
    const thin = (1 - across) ** 5;
    for (let x = 0; x < w; x++) {
      const along = Math.abs((x + 0.5) / w - 0.5) * 2;
      const spread = (1 - along) ** 2.4;
      const value = thin * spread;
      const p = (y * w + x) * 4;
      // Cool at the extremities, white at the core: dispersion, not a tint.
      const chill = Math.min(1, along * 1.15);
      pixels[p] = Math.round(255 - 40 * chill);
      pixels[p + 1] = Math.round(255 - 14 * chill);
      pixels[p + 2] = 255;
      pixels[p + 3] = Math.round(Math.max(0, Math.min(1, value)) * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  return textureOf(ctx);
}

/**
 * The lens flash: a bloom centred where the light is, not in the middle of the
 * frame.
 *
 * Offset along `LIGHT_RIG.screen` for the same reason every panel's rim
 * highlight is on its top-left edge. A flash that blooms from the centre of the
 * screen while the whole scene is lit from the upper left has two suns in it,
 * which is the defect §0 of the foundation contract calls the one thing fifteen
 * parallel builders will get wrong.
 */
export function flashTexture(): THREE.Texture {
  const size = 256;
  const ctx = canvas(size, size);
  if (!ctx) return textureOf(null);
  const cx = size * (0.5 + LIGHT_RIG.screen.x * 0.18);
  const cy = size * (0.5 + LIGHT_RIG.screen.y * 0.18);
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.82);
  gradient.addColorStop(0, "rgba(255,246,255,1)");
  gradient.addColorStop(0.22, "rgba(248,214,255,0.72)");
  gradient.addColorStop(0.52, "rgba(196,126,255,0.3)");
  gradient.addColorStop(1, "rgba(120,70,200,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return textureOf(ctx);
}

/**
 * The vignette, as a black plate with a hole in it.
 *
 * Offset *against* the key light, so the corner furthest from the lamp is the
 * darkest one. It is a two-pixel decision that nobody will ever name and that
 * makes the frame look lit rather than masked.
 */
export function vignetteTexture(): THREE.Texture {
  const size = 256;
  const ctx = canvas(size, size);
  if (!ctx) return textureOf(null);
  const cx = size * (0.5 + LIGHT_RIG.screen.x * 0.06);
  const cy = size * (0.5 + LIGHT_RIG.screen.y * 0.06);
  const gradient = ctx.createRadialGradient(cx, cy, size * 0.18, cx, cy, size * 0.78);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.55, "rgba(0,0,0,0.16)");
  gradient.addColorStop(0.82, "rgba(0,0,0,0.52)");
  gradient.addColorStop(1, "rgba(3,1,8,0.9)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return textureOf(ctx);
}

/**
 * The reflection, baked: flipped, blurred and faded in one bitmap.
 *
 * The obvious build is a mirrored mesh with the artwork as its `map` and a
 * vertical ramp as its `alphaMap`, and it works — but `USE_ALPHAMAP` is a shader
 * define, so that one mesh was compiling a *fifth* shader program for itself.
 * On this page the whole cinematic's first frame costs about sixty milliseconds
 * of shader compilation per distinct program, so a reflection that needs its own
 * program is a reflection that costs a frame and a half of blocked main thread
 * on a live lobby.
 *
 * Everything it needed is static — the flip, the blur and the fade never change
 * — so all three are painted once into the bitmap and the mesh becomes an
 * ordinary textured quad like every other object on the set.
 *
 * `destination-in` composites the ramp against the artwork's *existing* alpha
 * rather than drawing over it, which is what keeps the letterforms' own edges
 * and multiplies the fade through them.
 */
export function reflectionTexture(source: BrandSource, sigmaFraction: number): {
  texture: THREE.Texture;
  scale: number;
} | null {
  const bloom = bloomOf(source, sigmaFraction);
  if (!bloom) return null;
  const image = (bloom.texture as THREE.CanvasTexture).image as HTMLCanvasElement | undefined;
  if (!image?.width) return bloom;

  const ctx = canvas(image.width, image.height);
  if (!ctx) return bloom;

  // Flipped on the way in, so the mesh stays upright and its UVs stay ordinary.
  ctx.save();
  ctx.translate(0, image.height);
  ctx.scale(1, -1);
  ctx.drawImage(image, 0, 0);
  ctx.restore();

  const ramp = ctx.createLinearGradient(0, 0, 0, image.height);
  ramp.addColorStop(0, "rgba(0,0,0,0.9)");
  ramp.addColorStop(0.34, "rgba(0,0,0,0.3)");
  ramp.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = ramp;
  ctx.fillRect(0, 0, image.width, image.height);
  ctx.globalCompositeOperation = "source-over";

  return { texture: textureOf(ctx), scale: bloom.scale };
}

/**
 * The game's film grain, cloned so it can be tiled and offset here without
 * touching the copy every DOM surface in the build is already wearing.
 *
 * A clone shares the source bitmap and owns its own `repeat`/`offset`, so this
 * is literally the same grain as `.mat-panel`'s at a different scale, and
 * disposing it at teardown frees this clone's binding rather than the shared
 * one. Generating a second noise field instead would put two different grains on
 * screen across the cross-fade into the lobby, which the eye reads as two
 * materials even when it cannot say why.
 */
export function grainTexture(): THREE.Texture {
  /**
   * 0.14 peak, and the arithmetic behind it.
   *
   * `texture.ts` exports `grainContrast(amount, face)` for exactly this: the
   * rendered high-pass ratio of a grain of peak alpha `amount` over a plate of
   * luma `face`. The backdrop averages around 50, which gives a contrast of
   * roughly `0.95 × amount × planeOpacity`; at a plane opacity of 0.45 that
   * lands 0.14 at about 6% — the middle of the 2–6% §1 asks for, and the same
   * figure the four material tiles are tuned to.
   *
   * It shipped once at 0.42 with the plane at 0.85, which is 34%, and the
   * screenshot is unambiguous: the title sequence looked like analogue
   * television static with a logo behind it. Grain is the ingredient that is
   * invisible when it is right and the only thing you can see when it is wrong.
   */
  const shared = noiseTexture({ size: 128, amount: 0.14, clump: 0.5 });
  const clone = shared.clone();
  clone.wrapS = THREE.RepeatWrapping;
  clone.wrapT = THREE.RepeatWrapping;
  clone.needsUpdate = true;
  return own(clone);
}

// ---------------------------------------------------------------------------
// colour
// ---------------------------------------------------------------------------

/**
 * The nightlife palette, taken from the Currents rather than invented.
 *
 * These are the eight hues the cards are built from, so the lights in the room
 * behind the logo are the same lights that are on the cards — and because they
 * are read out of `CURRENT_PALETTE` at call time, a player in a colour-blind
 * mode gets a title sequence lit by the palette they actually see.
 *
 * The order is the weighting: `pulse`, `prism` and `veil` lead because the brand
 * mark is magenta-violet and the room should agree with it, with `tide` and
 * `cinder` for the cool and warm accents that stop it being monochrome.
 */
const NIGHTLIFE: readonly CurrentId[] = ["pulse", "prism", "veil", "tide", "cinder", "halo", "gale"];

export function nightlifeColour(index: number, bright = false): THREE.Color {
  const id = NIGHTLIFE[index % NIGHTLIFE.length]!;
  const palette = CURRENT_PALETTE[id];
  return new THREE.Color(bright ? palette.hi : palette.key);
}

export const NIGHTLIFE_COUNT = NIGHTLIFE.length;

// ---------------------------------------------------------------------------
// teardown
// ---------------------------------------------------------------------------

/** Free every texture this module made. Shared textures are not in the set. */
export function disposeIntroTextures(): void {
  for (const texture of owned) texture.dispose();
  owned.clear();
}
