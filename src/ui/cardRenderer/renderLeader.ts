/**
 * Leader portrait — "the Sigil".
 *
 * A leader is not a card you play, so it must not look like one. The previous
 * version was an arch: a semicircular dome on straight vertical sides with a
 * near-flat bottom. Measuring the reference footage showed why that failed —
 * the reference's own hero portrait is *also* rectangular across its lower half
 * (vertical sides to within 1px over 106 rows, flat bottom, 6px corner fillets),
 * and it still reads as a portrait because it is a window cut into board
 * masonry with no free-floating outer edge. We have no masonry, so copying the
 * silhouette copied the wrong half of the idea and kept the card reading.
 *
 * This is a struck medallion instead: a landscape disc, art edge-to-edge, two
 * gems clamped to the rim as lugs. Four things stop it reading as a card, in
 * measured order of strength: the aspect is inverted (1.33 wide against a
 * card's 0.753 tall), there is not one straight vertical edge or corner
 * anywhere, the outline is interrupted by the lugs so it is not a single convex
 * loop, and it is 55% art by area against a card's ~25% with no name plate,
 * cost gem, type line or rules box.
 *
 * The rim is the Current's signature. Every profile is inscribed in the same
 * circle, so all eight leaders share one world footprint and only the edge
 * treatment changes — and because the shape carries the identity, the Current
 * survives greyscale, which the project's accessibility rules require.
 *
 * ## The coin takes its light from `material.ts` and owns none of its own
 *
 * It used to own all of it. A local `metalGradient` built a conic starting at
 * 2.356 rad and a linear from (94,40) to (346,292), and said so in its own doc
 * comment: "shadowed upper-left, specular lower-right". Measured on 460px coins
 * with the gems suppressed, Cinder was 3.7:1 brighter at the bottom-right, Tide
 * 28:1, and Halo's specular peaked at 310° on screen — against a card frame that
 * is 31.8:1 brighter at the *top*-left. The coin sits directly above the hand
 * for the whole of every match, so the board had two suns in one frame, which is
 * the defect the bar says reads as amateur before a viewer can name it.
 *
 * There is nothing left here that decides where the light is. The ring is
 * `bandFace` and `bandShelf` with the Current's own metal, which is the same
 * pair of calls and the same stops the card rim makes, and both of them derive
 * their direction from `TO_LIGHT`.
 */

import type { CardDef, CurrentId } from "../../engine/types";
import { CURRENT_PALETTE, hexToRgba, mix } from "./palette";
import { drawPlaceholderArt } from "./placeholderArt";
import { getCardArt, onArtLoaded } from "../art/artLoader";
import {
  bandFace,
  bandShelf,
  drawGem,
  drawNumber,
  edgeGradient,
  grainOver,
  innerCast,
  crossfadeIn,
  onCardTextureReady,
  refreshCardStyle,
  type Metal,
} from "./material";

/** Canonical portrait size — landscape, because a card never is. */
export const LEADER_W = 440;
export const LEADER_H = 332;

/** Disc centre. Every anchor uses this: it is fixed even when armour is absent. */
const CX = 220;
const CY = 166;

const R_OUT = 150; // outer edge of the Current metal ring
const R_METAL = 138; // inner edge of the metal ring
const R_ART = 126; // outer edge of the art

export interface LeaderPortraitState {
  health: number;
  maxHealth: number;
  armor?: number;
  /** highlight ring when the leader is a legal target */
  highlight?: "none" | "target";
  art?: HTMLImageElement | ImageBitmap | null;
}

// ---------------------------------------------------------------------------
// Current rim profiles
// ---------------------------------------------------------------------------

const PROFILE_STEP = 2; // degrees
const PROFILE_N = 360 / PROFILE_STEP;

const rad = (deg: number): number => (deg * Math.PI) / 180;
const wrap = (deg: number): number => ((deg % 360) + 360) % 360;

/**
 * Polar radius of the straight segment joining two polar points. Interpolating
 * the radius directly would bow every edge outward; this keeps facets flat, so
 * Prism reads as a cut gem and Veil as knapped stone rather than as lumps.
 */
function chordRadius(a: number, ra: number, b: number, rb: number, deg: number): number {
  const denom = ra * Math.sin(rad(deg - a)) + rb * Math.sin(rad(b - deg));
  if (Math.abs(denom) < 1e-6) return ra;
  return (ra * rb * Math.sin(rad(b - a))) / denom;
}

/** Sample a closed profile defined by control points joined with straight edges. */
function facetedProfile(points: { deg: number; rho: number }[]): number[] {
  const sorted = points
    .map((p) => ({ deg: wrap(p.deg), rho: p.rho }))
    .sort((a, b) => a.deg - b.deg);
  const first = sorted[0];
  if (!first) return new Array<number>(PROFILE_N).fill(1);
  const ext = [...sorted, { deg: first.deg + 360, rho: first.rho }];

  const out: number[] = [];
  for (let i = 0; i < PROFILE_N; i++) {
    let deg = i * PROFILE_STEP;
    if (deg < ext[0]!.deg) deg += 360;
    let segment = ext[0]!;
    let next = ext[1] ?? ext[0]!;
    for (let k = 0; k < ext.length - 1; k++) {
      if (ext[k]!.deg <= deg && deg <= ext[k + 1]!.deg) {
        segment = ext[k]!;
        next = ext[k + 1]!;
        break;
      }
    }
    out.push(chordRadius(segment.deg, segment.rho, next.deg, next.rho, deg));
  }
  return out;
}

/** Sample a profile defined by a continuous function of the angle. */
function functionProfile(f: (deg: number) => number): number[] {
  const out: number[] = [];
  for (let i = 0; i < PROFILE_N; i++) out.push(f(i * PROFILE_STEP));
  return out;
}

/** Circular moving average — used to fillet corners without special-casing them. */
function smoothProfile(values: number[], passes: number): number[] {
  let current = values;
  for (let pass = 0; pass < passes; pass++) {
    const next = current.map((_, i) => {
      const prev = current[(i - 1 + current.length) % current.length]!;
      const here = current[i]!;
      const after = current[(i + 1) % current.length]!;
      return (prev + here * 2 + after) / 4;
    });
    current = next;
  }
  return current;
}

/** Angular distance between two headings, in degrees. */
function arcDistance(a: number, b: number): number {
  const d = Math.abs(wrap(a) - wrap(b));
  return Math.min(d, 360 - d);
}

/**
 * One profile per Current, keyed off the palette's existing `shape` name so the
 * leader speaks the same shape language as the card frames.
 */
function buildProfile(shape: string): number[] {
  switch (shape) {
    // Nine saw notches licking clockwise.
    case "flame-notch": {
      const points: { deg: number; rho: number }[] = [];
      for (let i = 0; i < 9; i++) {
        const t = i * 40 - 90;
        points.push({ deg: t, rho: 1 }, { deg: t + 13, rho: 0.9 }, { deg: t + 22, rho: 0.985 });
      }
      return facetedProfile(points);
    }

    /**
     * Five shallow ripples. Three lobes was the original spec, but three reads
     * as a dome with a point at 12 o'clock — an arch, which is the exact shape
     * this whole medallion exists to get away from — and it collides with
     * Prism, which is also three-fold. Five keeps the disc unmistakably round
     * and leaves Prism the only triangular silhouette.
     */
    case "wave-round":
      return functionProfile((deg) => 1 - 0.055 * (1 - Math.cos(rad(5 * (deg + 90)))));

    // Pointy-side hexagon: vertices at 3 and 9 o'clock, flats top and bottom,
    // so it is 15% wider than tall — the opposite proportion to a card.
    case "hex-stone":
      return smoothProfile(
        // No phase offset: `wrap(deg + 30)` would put the vertices at 12 and 6
        // o'clock instead, which makes the disc 0.888 wide-to-tall — the only
        // portrait medallion of the eight — and gives it dead-straight vertical
        // edges at 3 and 9 o'clock. Both are exactly the card-like cues this
        // whole shape exists to avoid.
        functionProfile((deg) => {
          const local = (wrap(deg) % 60) - 30;
          return Math.cos(rad(30)) / Math.cos(rad(local));
        }),
        5
      );

    // A disc with two opposed straight shears.
    case "ribbon-sweep":
      return smoothProfile(
        functionProfile((deg) => {
          const d = wrap(deg);
          if (d > 288 && d < 342) return chordRadius(288, 1, 342, 1, d);
          if (d > 108 && d < 162) return chordRadius(108, 1, 162, 1, d);
          return 1;
        }),
        1
      );

    // Machined hub: four square tabs on the diagonals, four bites on the axes.
    case "circuit-angle":
      return functionProfile((deg) => {
        for (const tab of [45, 135, 225, 315]) if (arcDistance(deg, tab) <= 11) return 1;
        for (const bite of [0, 90, 180, 270]) if (arcDistance(deg, bite) <= 8) return 0.87;
        return 0.93;
      });

    // Identified by its purity — the only unbroken circle.
    case "radiant-circle":
      return functionProfile(() => 1);

    // Seven irregular chords: a knapped, broken disc.
    case "shard-mirror":
      return facetedProfile([
        { deg: 274, rho: 1 },
        { deg: 327, rho: 0.905 },
        { deg: 11, rho: 1 },
        { deg: 58, rho: 0.875 },
        { deg: 119, rho: 1 },
        { deg: 166, rho: 0.895 },
        { deg: 213, rho: 0.985 },
      ]);

    // Twelve straight facets over a three-lobe swell — a cut gem, not a wobble.
    case "crystal-facet": {
      const points: { deg: number; rho: number }[] = [];
      for (let i = 0; i < 12; i++) {
        const deg = -90 + i * 30;
        points.push({ deg, rho: 0.88 + 0.12 * Math.cos(rad(3 * (deg + 90))) });
      }
      return facetedProfile(points);
    }

    default:
      return functionProfile(() => 1);
  }
}

const profileCache = new Map<string, number[]>();

function profileFor(current: CurrentId): number[] {
  const shape = CURRENT_PALETTE[current].shape;
  let profile = profileCache.get(shape);
  if (!profile) {
    profile = buildProfile(shape);
    profileCache.set(shape, profile);
  }
  return profile;
}

/**
 * Trace the rim at radius `k`. All three boundaries — outer contour, metal
 * inner edge and art clip — share one profile, so the Current's signature
 * appears twice across the chrome and stays legible at ~92px on screen.
 */
function traceRim(ctx: CanvasRenderingContext2D | Path2D, profile: number[], k: number): void {
  for (let i = 0; i < profile.length; i++) {
    const theta = rad(i * PROFILE_STEP);
    const r = k * profile[i]!;
    const x = CX + r * Math.cos(theta);
    const y = CY + r * Math.sin(theta);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** The same contour as a reusable path, for the fills and strokes that share one. */
function rimPath(profile: number[], k: number): Path2D {
  const path = new Path2D();
  traceRim(path, profile, k);
  return path;
}

// ---------------------------------------------------------------------------
// Gems
// ---------------------------------------------------------------------------

/**
 * Numerals are the most-read thing on the board and they render small here, so
 * they are outlined by stroking before filling. A shadow blur alone smears at
 * this size instead of separating the glyph from the gem.
 */
/**
 * Health: the same rounded brilliant the card face uses, clamped to the rim at
 * lower-right.
 *
 * It was a hand-drawn blood drop with a radial gradient and a black contour, and
 * a leader medallion sat next to a board card wearing two entirely different
 * ideas of what a health gem is. One primitive, one light, one bevel: the
 * *shape* still differs from armour so the two stay separable in greyscale, but
 * the material no longer does.
 */
function drawHealthGem(ctx: CanvasRenderingContext2D, value: number, state: LeaderPortraitState): void {
  drawGem(ctx, {
    shape: "round",
    cx: 355,
    cy: 240,
    r: 58,
    metal: { hi: "#ffc2c2", key: "#d8394c", lo: "#66101c", abyss: "#33070e" },
    socket: true,
    glow: 0.3,
    lift: 5,
  });

  const damaged = value < state.maxHealth;
  const over = value > state.maxHealth;
  drawNumber(ctx, value, 355, 241, {
    size: 62,
    maxWidth: 82,
    colour: over ? "#a6ffbc" : damaged ? "#ffb4b4" : "#ffffff",
    outline: 8,
  });
}

/**
 * Armour: a shield-cut of the same stone, in steel. The inverted silhouette
 * means health and armour stay separable in pure greyscale, from shape alone.
 * The reference carries no armour at all, so this one is designed, not copied.
 */
function drawArmourGem(ctx: CanvasRenderingContext2D, value: number): void {
  drawGem(ctx, {
    shape: "shield",
    cx: 85,
    cy: 232,
    r: 50,
    // Desaturated steel, deliberately not a saturated blue, so it never reads as
    // Tide's key colour on a Tide leader.
    metal: { hi: "#e4eefb", key: "#6d8ba8", lo: "#26445f", abyss: "#122536" },
    socket: true,
    lift: 5,
  });
  drawNumber(ctx, value, 85, 231, { size: 48, maxWidth: 62, colour: "#ffffff", outline: 7 });
}

// ---------------------------------------------------------------------------
// Portrait
// ---------------------------------------------------------------------------

export function renderLeaderPortrait(
  ctx: CanvasRenderingContext2D,
  card: CardDef,
  state: LeaderPortraitState
): void {
  const palette = CURRENT_PALETTE[card.current as CurrentId];
  const profile = profileFor(card.current as CurrentId);
  refreshCardStyle();
  ctx.clearRect(0, 0, LEADER_W, LEADER_H);

  // --- contact shadow: grounds the coin, and is a second round cue ----------
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(CX, 320, 120, 11, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.34)";
  ctx.shadowColor = "rgba(0,0,0,0.34)";
  ctx.shadowBlur = 14;
  ctx.fill();
  ctx.restore();

  // --- targeting glow: must trace the profile, notches and all --------------
  if (state.highlight === "target") {
    ctx.save();
    ctx.shadowColor = "#ff5f7a";
    ctx.shadowBlur = 22;
    ctx.strokeStyle = "#ff5f7a";
    ctx.lineWidth = 7;
    ctx.beginPath();
    traceRim(ctx, profile, 155);
    ctx.stroke();
    ctx.restore();
  }

  // --- art, clipped to the rim ---------------------------------------------
  ctx.save();
  ctx.beginPath();
  traceRim(ctx, profile, R_ART);
  ctx.clip();

  const art = state.art ?? getCardArt(card);
  if (art) {
    const iw = "width" in art ? art.width : R_ART * 2;
    const ih = "height" in art ? art.height : R_ART * 2;
    // A circle is the least forgiving crop for a face, so bias to the upper
    // third where the head sits in full-bleed leader art, then clamp so the
    // disc is always fully covered whatever the source aspect.
    const scale = Math.max((R_ART * 2) / iw, (R_ART * 2) / ih) * 1.25;
    const dw = iw * scale;
    const dh = ih * scale;
    const dy = Math.min(CY - R_ART, Math.max(CY + R_ART - dh, CY - 0.33 * dh));
    ctx.drawImage(art as CanvasImageSource, CX - dw / 2, dy, dw, dh);
  } else {
    /**
     * The placeholder inside a circular clip.
     *
     * This is the case that used to produce a keyhole: a torso-and-head
     * silhouette composed against a square, cropped to a disc, with the head the
     * only part above the scrim. The composition is rotational now, which is why
     * the same routine can fill a 512×680 rectangle and a 252px circle without
     * either one reading as a crop — and the disclosure is placed by the caller,
     * because only the caller knows the gems are about to cover the lower third.
     */
    drawPlaceholderArt(
      ctx,
      { x: CX - R_ART, y: CY - R_ART, w: R_ART * 2, h: R_ART * 2 },
      card.current,
      card.name,
      { faction: card.faction, disclosure: { cx: CX, y: CY + R_ART * 0.52, width: R_ART * 1.5 } }
    );
  }

  // a touch of the Current's colour so leaders still read elementally
  ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = hexToRgba(palette.key, 0.12);
  ctx.fillRect(0, 0, LEADER_W, LEADER_H);
  ctx.globalCompositeOperation = "source-over";

  // bottom scrim so the gems and lower rim sit on something
  const scrim = ctx.createLinearGradient(0, CY, 0, CY + 126);
  scrim.addColorStop(0, "rgba(0,0,0,0)");
  scrim.addColorStop(1, hexToRgba(palette.abyss, 0.72));
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, LEADER_W, LEADER_H);
  ctx.restore();

  // --- dark bezel between art and metal ------------------------------------
  ctx.save();
  ctx.beginPath();
  traceRim(ctx, profile, R_METAL);
  traceRim(ctx, profile, R_ART);
  ctx.fillStyle = mix(palette.abyss, "#000000", 0.35);
  ctx.fill("evenodd");
  ctx.restore();

  // light-catch on the bezel's inner edge
  ctx.save();
  ctx.strokeStyle = hexToRgba(palette.hi, 0.4);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  traceRim(ctx, profile, R_ART);
  ctx.stroke();
  ctx.restore();

  // --- metal ring: the Current's one large coloured surface ----------------
  const ringOuter = rimPath(profile, R_OUT);
  const ringInner = rimPath(profile, R_METAL);
  const ring = new Path2D();
  ring.addPath(ringOuter);
  ring.addPath(ringInner);
  const bounds = { x: CX - R_OUT, y: CY - R_OUT, w: R_OUT * 2, h: R_OUT * 2 };
  const metal: Metal = { hi: palette.hi, key: palette.key, lo: palette.lo, abyss: palette.abyss };

  ctx.save();
  ctx.fillStyle = bandFace(ctx, bounds, metal);
  ctx.fill(ring, "evenodd");
  ctx.restore();

  /**
   * The moulding, which is the other half of what the card frame does.
   *
   * A ring filled with one gradient is a coloured stripe however correctly it is
   * lit. What reads as *struck metal* is the narrow high-contrast specular where
   * a profile changes angle, so the ring is cut into two steps — an outer lip and
   * a recessed inner shelf — and the wall between them is stroked with the same
   * edge gradient the card's shelf uses: white where it faces the light, black
   * where it turns away. The proportions are the card's, 42% of the band's width
   * given to the lip, so a coin and a card frame are recognisably the same
   * section at two scales.
   */
  const shelfRadius = R_OUT - (R_OUT - R_METAL) * 0.42;
  const shelfPath = rimPath(profile, shelfRadius);
  const shelf = new Path2D();
  shelf.addPath(shelfPath);
  shelf.addPath(ringInner);
  ctx.save();
  ctx.fillStyle = bandShelf(ctx, bounds, metal);
  ctx.fill(shelf, "evenodd");
  ctx.restore();

  // the same grain every other surface in the game wears, at one cell per
  // device pixel, so the coin is not a mathematically smooth gradient
  grainOver(ctx, ring, 0.95, "evenodd");

  // the wall of the step
  ctx.save();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = edgeGradient(ctx, bounds, 0.5, 0.58);
  ctx.stroke(shelfPath);
  ctx.restore();

  /**
   * Contours, lit rather than flat black.
   *
   * Both edges used to be a uniform dark stroke, which separates the coin from
   * the mat and says nothing about which way it faces. Stroking each with the
   * shared edge gradient means the outer wall catches the key light on its
   * top-left and the inner wall — which faces the other way — catches it on its
   * bottom-right, and the ring reads as a raised bezel instead of an outline.
   */
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = edgeGradient(ctx, bounds, 0.4, 0.8);
  ctx.stroke(ringOuter);
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = edgeGradient(ctx, bounds, 0.3, 0.72, true);
  ctx.stroke(ringInner);
  ctx.restore();

  // and the ring's own shadow, falling across the portrait it surrounds
  innerCast(ctx, rimPath(profile, R_ART), bounds, { blur: 14, alpha: 0.6, lift: 6, tone: "dark", away: true });

  // Halo is identified by being a perfect circle, so it gets the one piece of
  // added detail that reinforces rather than breaks that: a tick ring.
  if (palette.shape === "radiant-circle") {
    ctx.save();
    ctx.strokeStyle = hexToRgba(palette.hi, 0.55);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(CX, CY, 142, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = hexToRgba(palette.hi, 0.35);
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const theta = rad(i * 30);
      ctx.beginPath();
      ctx.moveTo(CX + 139 * Math.cos(theta), CY + 139 * Math.sin(theta));
      ctx.lineTo(CX + 144 * Math.cos(theta), CY + 144 * Math.sin(theta));
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- gems: armour first, health last so it wins any overlap --------------
  if (state.armor && state.armor > 0) drawArmourGem(ctx, state.armor);
  drawHealthGem(ctx, state.health, state);
}

/** Render a leader portrait into a canvas; repaints when its art loads. */
export function renderLeaderToCanvas(
  card: CardDef,
  width: number,
  state: LeaderPortraitState
): HTMLCanvasElement {
  const scale = width / LEADER_W;
  const dpr = Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(LEADER_W * scale * dpr);
  canvas.height = Math.round(LEADER_H * scale * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const paint = (): void => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(scale * dpr, scale * dpr);
    renderLeaderPortrait(ctx, card, state);
  };
  paint();

  /**
   * The art-loaded crossfade, matching the card face.
   *
   * A leader medallion is the largest single image on the lobby and on the
   * board, and it was the most conspicuous pop in the game: art-pending one
   * frame, painted the next.
   */
  const fadeIn = (): void => {
    crossfadeIn(
      canvas,
      (target) => {
        target.scale(scale * dpr, scale * dpr);
        renderLeaderPortrait(target, card, state);
      },
      paint
    );
  };

  const unsubscribe = onArtLoaded((cardId) => {
    if (cardId !== card.id) return;
    fadeIn();
    unsubscribe();
  });

  const unsubscribeGrain = onCardTextureReady(() => {
    paint();
    unsubscribeGrain();
  });

  return canvas;
}
