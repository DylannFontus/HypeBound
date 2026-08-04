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
    const length = head * tail * tail;
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
