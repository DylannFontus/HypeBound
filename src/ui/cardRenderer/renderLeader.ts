/**
 * The leader — a carved plaque with a portrait cut into it.
 *
 * Every other object in this domain got the material treatment and this one did
 * not, and it is on screen twice for the whole of every match. What it was: a
 * five-pixel coloured outline around a portrait cover-fitted into a round hole
 * that cropped through people's faces, with a flat grey shield sixty pixels from
 * a faceted crystalline health gem — two different ideas of what a chip is, on
 * one object — and a "30" a third of the portrait's width sitting *on* the ring
 * with no socket and nothing under it. No name, no plate, no keystone, no light
 * on the metal, and eight silhouettes that were not a family: Cinder a lumpy
 * blob, Halo a plain circle, Gale an octagon. Held next to the reference's hero —
 * a sculpted stone arch on a plinth, with an inset bronze medallion and a health
 * gem seated in a cut socket — it named the project as indie in under a second.
 *
 * ## The shape argument, resolved rather than repeated
 *
 * The version before that was an arch, and it was replaced with a coin because
 * an arch on a floating quad read as a card. The version after that was a coin,
 * and a coin is the worst possible aperture for a portrait: a circle is narrow
 * exactly where a head is, so the mask pinched through the top of every face.
 *
 * Both are half right and the reference has been showing the whole answer the
 * entire time. Its hero *is* a portrait arch — and it does not read as a card
 * because the arch is a **window in a wide plaque**, with two thirds of the
 * object's width being masonry on either side of it. So that is what this is: a
 * 1.6:1 landscape plaque, an arched aperture down the middle where a face fits,
 * two wings of metal carrying the gems, a keystone at the apex with the faction
 * crest in it, and a name banner nailed across the bottom. The outer silhouette
 * is landscape and interrupted; nothing about it is card-shaped.
 *
 * ## The outline is the card's outline, widened — literally the same function
 *
 * The version before this one drew a superellipse with a per-Current wobble
 * modulating its radius, and photographed as exactly what that is: a soft blob
 * lozenge. Beside a card whose silhouette is chamfered and cut per Current, two
 * leaders sat on screen for a hundred per cent of every match speaking a
 * different design language — a HUD widget next to printed objects.
 *
 * There was never a reason to have a second silhouette generator. `frameShapes`
 * takes a *rectangle* and a Current and cuts it; nothing in it assumes portrait
 * proportions. So the plaque is `bandPaths(shape, landscapeRect, BAND)` — the
 * same call, the same eight cuts, the same inner-contour exaggeration, the same
 * band section — and a leader is now visibly a card that has been widened rather
 * than a different kind of object. Cinder's flames lick the top rail of the
 * plaque exactly as they lick the top rail of a Cinder card in the hand below it.
 * A hundred and twenty lines of bespoke profile maths went with it.
 *
 * ## It takes its light and its clock from the same places every card does
 *
 * Nothing here decides where the light is: the plate is `bandFace` and
 * `bandShelf` with the Current's metal, the same pair of calls and the same
 * stops the card rim makes, and both derive their direction from `TO_LIGHT`.
 * And the medallion now registers with `cardClock` like every other large card
 * surface, so the one object that is on screen for the entire match is no longer
 * the only one that is a static bitmap.
 */

import type { CardDef, CurrentId } from "../../engine/types";
import {
  CURRENT_PALETTE,
  FACTION_COLOR,
  FACTION_INDEX,
  RARITY_STYLE,
  frameMetal,
  frameSpecular,
  hexToRgba,
  mix,
} from "./palette";
import { drawPlaceholderArt } from "./placeholderArt";
import { drawCurrentIcon, drawFactionCrest } from "./icons";
import { getCardArt, onArtLoaded } from "../art/artLoader";
import { registerCardSurface } from "./cardClock";
import { bandPaths, framePath, type BandPaths } from "./frameShapes";
import {
  TO_LIGHT,
  bandFace,
  bandShelf,
  castShadow,
  drawCardName,
  drawGem,
  drawNumber,
  edgeGradient,
  grainOver,
  innerCast,
  litGradient,
  crossfadeIn,
  onCardFontsReady,
  onCardTextureReady,
  raisedPlate,
  refreshCardStyle,
  roundRectPath,
  specularBand,
  sunkenPlate,
  type Metal,
  type Rect,
} from "./material";

/**
 * Canonical plaque size — 1.35:1 landscape, because a card is 0.75:1 portrait
 * and the one thing a leader must never be mistaken for is a card.
 */
export const LEADER_W = 460;
export const LEADER_H = 340;

/** The plaque itself: the rectangle `frameShapes` cuts the Current's outline from. */
const PLATE: Rect = { x: 26, y: 14, w: 408, h: 300 };
const CX = PLATE.x + PLATE.w / 2;

/**
 * Thickness of the frame band, and it is a card's band rather than a number
 * picked for this file: `RARITY_STYLE.epic.band` is 27, and a leader is the one
 * card in a deck that outranks every other. Read through the table so that a
 * retune of the card frame's section carries the plaque with it.
 */
const BAND = RARITY_STYLE.epic.band;

/** The arched aperture the portrait is cut into. */
const ARCH = { cx: CX, half: 80, top: 50, rise: 52, bottom: 230, fillet: 18 };

/**
 * The name banner — inside the plaque outline, which is the whole of the fix.
 *
 * It used to be 380px wide at y 246 on a plaque whose bottom edge was 274 and
 * which was a superellipse, so both ends of the banner hung out past the body
 * into empty canvas: on Prisma, King Ratio and The Widow of Dead Fandoms you
 * could see daylight between the banner's corners and the plaque behind them. A
 * plate nailed across the front of an object has to be *on* the object.
 */
const BANNER: Rect = { x: 54, y: 234, w: 352, h: 52 };
const BANNER_CAP = 42;

/**
 * The two chips, seated in sockets cut through the wing.
 *
 * A card face sets its stat gems into the two places its frame is widest — the
 * bottom corners — and the leader's equivalent of those is the masonry either
 * side of the aperture. They used to straddle the plaque's own outer edge with
 * their mounts running off it into the mat, which reads as a badge stuck near an
 * object rather than a stone set into one; they now sit fully inside the wing
 * with the socket biting into the band from the inside, so the metal is
 * genuinely interrupted and the stone has a wall to sit against.
 */
const ARMOUR_CHIP = { cx: 88, cy: 150, r: 34 };
const HEALTH_CHIP = { cx: 372, cy: 150, r: 40 };

export interface LeaderPortraitState {
  health: number;
  maxHealth: number;
  armor?: number;
  /** highlight ring when the leader is a legal target */
  highlight?: "none" | "target";
  art?: HTMLImageElement | ImageBitmap | null;
  /** 0–1 position of the specular crawling the plaque, from the shared clock */
  sheen?: number;
}

// ---------------------------------------------------------------------------
// The plaque outline
// ---------------------------------------------------------------------------

/**
 * The plaque outline, the shelf and the field, from the card's own generator.
 *
 * `bandPaths` is memoised on shape-plus-rectangle-plus-inset and the arguments
 * here are constants, so the whole game asks it for one of eight answers and the
 * leader pays for its silhouette exactly once per Current per session — which is
 * why the profile loop this replaced, three hundred and sixty trigonometric
 * samples per repaint on a surface the idle clock repaints twelve times a
 * second, is also gone as a cost.
 */
function plaquePaths(current: CurrentId): BandPaths {
  return bandPaths(CURRENT_PALETTE[current].shape, PLATE, BAND);
}

function shelfPath(current: CurrentId): Path2D {
  const inset = BAND * 0.42;
  return framePath(CURRENT_PALETTE[current].shape, {
    x: PLATE.x + inset,
    y: PLATE.y + inset,
    w: PLATE.w - inset * 2,
    h: PLATE.h - inset * 2,
  });
}

/**
 * The aperture: a portrait arch, which is the only window shape a face fits in.
 *
 * Domed top, straight sides, filleted bottom corners — the reference's hero
 * window to within a few pixels, and the reason a head can be composed inside it
 * without the mask crossing anybody's hairline.
 */
function archPath(inset = 0): Path2D {
  const half = ARCH.half - inset;
  const left = ARCH.cx - half;
  const right = ARCH.cx + half;
  const spring = ARCH.top + ARCH.rise;
  const rise = ARCH.rise - inset * 0.6;
  const bottom = ARCH.bottom - inset;
  const fillet = Math.max(4, ARCH.fillet - inset * 0.5);

  /**
   * A segmental head on straight jambs, traced as a real elliptical arc.
   *
   * Two earlier versions and two different failures. Beziers with eyeballed
   * controls pulled the apex flat and the window read as a rounded rectangle; a
   * true semicircle read as an arch and then pinched every hairline off, because
   * ten pixels below the crown of a semicircle the opening is barely half its
   * width and a head is not. A rise two thirds of the half-width is the geometry
   * that gives both: unmistakably an arch, and nearly the full opening ten pixels
   * down. The aperture is also 0.89:1 against source art that is 0.75:1, so the
   * cover fit crops almost nothing.
   */
  const path = new Path2D();
  path.moveTo(left, spring);
  path.ellipse(ARCH.cx, spring, half, rise, 0, Math.PI, 0);
  path.lineTo(right, bottom - fillet);
  path.quadraticCurveTo(right, bottom, right - fillet, bottom);
  path.lineTo(left + fillet, bottom);
  path.quadraticCurveTo(left, bottom, left, bottom - fillet);
  path.closePath();
  return path;
}

const ARCH_BOUNDS: Rect = {
  x: ARCH.cx - ARCH.half,
  y: ARCH.top,
  w: ARCH.half * 2,
  h: ARCH.bottom - ARCH.top,
};

// ---------------------------------------------------------------------------
// Hardware
// ---------------------------------------------------------------------------

/**
 * The socket a chip is set into: a bite taken out of the wing, dark at the
 * bottom and catching light on its far wall.
 *
 * Cut before the gem is drawn and clipped to the plaque, so the metal is
 * genuinely interrupted rather than having a stone laid on top of it. This is
 * the missing half of what made the old "30" read as a sticker — `drawGem`
 * already drew a mount and a cast shadow, but the surface underneath was
 * unbroken, and a stone in an unbroken surface is a badge.
 */
function cutSocket(ctx: CanvasRenderingContext2D, plate: Path2D, cx: number, cy: number, r: number): void {
  const bounds: Rect = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
  const well = new Path2D();
  well.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.save();
  ctx.clip(plate);
  sunkenPlate(ctx, well, bounds, {
    metal: { hi: "#8e86ad", key: "#1a1530", lo: "#0c0818", abyss: "#040209" },
    amplitude: 0.9,
    grain: 0,
  });
  ctx.restore();
}

/**
 * Health and armour: two cuts of one stone.
 *
 * The shapes still differ — a rounded brilliant against a shield — because that
 * is the channel that separates them on a greyscale monitor. Everything else is
 * shared: one primitive, one bevel, one rim weight, one light, one socket
 * routine, one contact shadow. The old pair had a flat two-tone shield next to a
 * faceted crystal, which is two material vocabularies on an object four hundred
 * pixels wide.
 */
function drawChips(ctx: CanvasRenderingContext2D, plate: Path2D, state: LeaderPortraitState): void {
  if (state.armor && state.armor > 0) {
    const chip = ARMOUR_CHIP;
    cutSocket(ctx, plate, chip.cx, chip.cy, chip.r * 1.3);
    drawGem(ctx, {
      shape: "shield",
      cx: chip.cx,
      cy: chip.cy,
      r: chip.r,
      // desaturated steel, deliberately not a saturated blue, so it never reads
      // as Tide's key colour on a Tide leader
      metal: { hi: "#e4eefb", key: "#6d8ba8", lo: "#26445f", abyss: "#122536" },
      socket: true,
      lift: 4,
    });
    drawNumber(ctx, state.armor, chip.cx, chip.cy, {
      size: chip.r * 0.96,
      maxWidth: chip.r * 1.3,
      colour: "#ffffff",
      outline: 6,
    });
  }

  const chip = HEALTH_CHIP;
  cutSocket(ctx, plate, chip.cx, chip.cy, chip.r * 1.28);
  drawGem(ctx, {
    shape: "round",
    cx: chip.cx,
    cy: chip.cy,
    r: chip.r,
    metal: { hi: "#ffc2c2", key: "#d8394c", lo: "#66101c", abyss: "#33070e" },
    socket: true,
    // the stone sits inside the wing now rather than crossing the outline, so
    // its halo lands on metal and can afford to be a light rather than a hint
    glow: 0.3,
    lift: 5,
  });

  const damaged = state.health < state.maxHealth;
  const over = state.health > state.maxHealth;
  drawNumber(ctx, state.health, chip.cx, chip.cy + 1, {
    size: chip.r * 1.02,
    maxWidth: chip.r * 1.42,
    colour: over ? "#a6ffbc" : damaged ? "#ffb4b4" : "#ffffff",
    outline: 7,
  });
}

/**
 * The crest cartouche on the top rail, carrying the faction mark.
 *
 * It is doing the same job the set symbol does in the name plate's right cap on
 * a card face — a piece of collector furniture that also happens to be the
 * structural joint an arch needs at its crown.
 *
 * It was a narrow tapered keystone, 84 pixels across, hanging down off the top
 * rail into the dark field with a 30px well punched through the middle of it, so
 * two fifths of its area was hole. At board size that photographs as a luggage
 * tag stapled to the object. It is now the same tapered cartouche the *card
 * back* wears at its crown — twice as wide, half as deep, raked back into the
 * rail at both ends — so the three objects in this domain that need a crest all
 * carry it in the same piece of hardware.
 */
function drawCrestPlate(ctx: CanvasRenderingContext2D, card: CardDef, outer: Path2D, metal: Metal): void {
  const cx = ARCH.cx;
  const half = 86;
  const top = PLATE.y + 3;
  const bottom = ARCH.top + 6;
  const cy = (top + bottom) / 2;
  const bounds: Rect = { x: cx - half, y: top, w: half * 2, h: bottom - top };

  const plate = new Path2D();
  plate.moveTo(cx - half + 22, top);
  plate.lineTo(cx + half - 22, top);
  plate.lineTo(cx + half, cy);
  plate.lineTo(cx + half - 22, bottom);
  plate.lineTo(cx - half + 22, bottom);
  plate.lineTo(cx - half, cy);
  plate.closePath();

  /**
   * Clipped to the plaque, because it is masonry inside an arch rather than a
   * tab hanging off one. Unclipped and anchored on the rectangle's own top edge
   * it poked out past every silhouette that dips at the crown — Halo's dome and
   * Cinder's notches both.
   */
  ctx.save();
  ctx.clip(outer);
  castShadow(ctx, plate, 5, 0.5);
  ctx.fillStyle = bandFace(ctx, bounds, metal, 1.2);
  ctx.fill(plate);
  ctx.lineWidth = 2;
  ctx.strokeStyle = edgeGradient(ctx, bounds, 0.5, 0.7);
  ctx.stroke(plate);
  grainOver(ctx, plate, 0.7);
  specularBand(ctx, plate, bounds, { strength: 0.36, tint: mix(metal.hi, "#ffffff", 0.6), width: 0.1 });
  ctx.restore();

  const wellR = 15;
  const well = new Path2D();
  well.arc(cx, cy, wellR, 0, Math.PI * 2);
  sunkenPlate(ctx, well, { x: cx - wellR, y: cy - wellR, w: wellR * 2, h: wellR * 2 }, {
    metal: { hi: metal.hi, key: mix(metal.lo, "#000000", 0.4), lo: "#0a0714", abyss: "#04020a" },
    amplitude: 0.8,
    grain: 0,
  });
  drawFactionCrest(
    ctx,
    FACTION_INDEX[card.faction] ?? 10,
    cx,
    cy,
    12,
    hexToRgba(FACTION_COLOR[card.faction] ?? "#8f8aa8", 0.95),
    card.faction
  );

  // two studs on the raked ends, so the cartouche is fixed to the rail
  for (const side of [-1, 1] as const) {
    drawGem(ctx, {
      shape: "diamond",
      cx: cx + side * (half - 13),
      cy,
      r: 6.5,
      metal: {
        hi: mix(metal.hi, "#ffffff", 0.5),
        key: metal.key,
        lo: metal.lo,
        abyss: metal.abyss ?? "#05030c",
      },
      socket: false,
      lift: 2,
    });
  }
}

/**
 * The name banner, which the medallion has never had.
 *
 * A leader is the one card in the game whose name a player has to know without
 * clicking on it — it is the thing the whole deck is built around — and it was
 * the only large surface in the domain with no type on it at all. Same object as
 * the card face's name plate: a raised banner in the Current's darkened metal,
 * a sunken medallion in each cap, the name in the display face between them.
 */
function drawBanner(ctx: CanvasRenderingContext2D, card: CardDef, current: CurrentId, metal: Metal): void {
  const palette = CURRENT_PALETTE[current];
  const path = roundRectPath(BANNER, 12);

  raisedPlate(ctx, path, BANNER, {
    metal: {
      hi: mix(metal.hi, "#ffffff", 0.12),
      key: mix(metal.key, "#000000", 0.5),
      lo: mix(metal.lo, "#000000", 0.55),
      abyss: "#05030c",
    },
    amplitude: 0.62,
    lift: 6,
  });

  for (const side of [-1, 1] as const) {
    const cx = side < 0 ? BANNER.x + BANNER_CAP / 2 : BANNER.x + BANNER.w - BANNER_CAP / 2;
    const well = new Path2D();
    well.arc(cx, BANNER.y + BANNER.h / 2, BANNER_CAP / 2 - 7, 0, Math.PI * 2);
    sunkenPlate(ctx, well, { x: cx - BANNER_CAP / 2, y: BANNER.y, w: BANNER_CAP, h: BANNER_CAP }, {
      metal: { hi: metal.hi, key: mix(metal.lo, "#000000", 0.3), lo: "#0a0714", abyss: "#04020a" },
      amplitude: 0.8,
      grain: 0,
    });
  }

  const midY = BANNER.y + BANNER.h / 2;
  drawCurrentIcon(ctx, current, BANNER.x + BANNER_CAP / 2, midY, 13, mix(palette.hi, "#ffffff", 0.3));

  // the right cap is the rank star: a leader is always the deck's one legendary
  drawGem(ctx, {
    shape: "star",
    cx: BANNER.x + BANNER.w - BANNER_CAP / 2,
    cy: midY,
    r: 14,
    metal: { hi: "#fff3cd", key: "#ffc257", lo: "#7a4f0c", abyss: "#2e1c02" },
    socket: false,
    glow: 0.4,
    lift: 2,
  });

  /**
   * Two steps and a floor, through the card face's own routine.
   *
   * The ladder here was `[27, 22, 18]` and it behaved as a continuous shrink in
   * practice: measured, 'King Ratio' set at 27 and 'The Widow of Dead Fandoms'
   * at 18, so two leaders facing each other across a board printed their names
   * at half again each other's size. `drawCardName` is the same function the
   * card's name plate calls, and below its last step it condenses the face
   * rather than dropping the cap height — which is what keeps a long name and a
   * short one looking like they were set by the same typesetter.
   */
  drawCardName(ctx, card.name, BANNER.x + BANNER.w / 2, midY + 1, BANNER.w - BANNER_CAP * 2 - 14, [28, 23]);
}

/**
 * The chasing on the wings: courses of shallow relief following the arch, cut
 * into the dark field either side of it.
 *
 * The wings are the largest continuous surface on the object and §1 is
 * unambiguous about what an untextured surface is. Two strokes per course —
 * dark away from the light, pale toward it — which is the same emboss the card
 * back's guilloche uses and costs the same nothing.
 */
function drawChasing(ctx: CanvasRenderingContext2D, field: Path2D, metal: Metal): void {
  ctx.save();
  ctx.clip(field);
  ctx.lineWidth = 2;
  for (const [dx, dy, colour, alpha] of [
    [-TO_LIGHT.x * 1.7, -TO_LIGHT.y * 1.7, "#000000", 0.4],
    [TO_LIGHT.x * 1.2, TO_LIGHT.y * 1.2, metal.hi, 0.11],
  ] as const) {
    ctx.save();
    ctx.translate(dx, dy);
    ctx.strokeStyle = hexToRgba(colour, alpha);
    for (const inset of [-20, -42, -64]) ctx.stroke(archPath(inset));
    ctx.restore();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Portrait
// ---------------------------------------------------------------------------

/**
 * Fit the artwork into the arch so the mask never crosses a face.
 *
 * The old rule cover-fitted at an extra 1.25× zoom and anchored a third of the
 * way down, into a *circular* window — so the widest part of the head landed
 * where the aperture was narrowest and the mask cut through hair and ears on
 * leaders 1 and 5. An arch is 0.79:1 against source art that is 0.75:1, so the
 * cover fit is now almost exactly a width fit: 1.04× of zoom, anchored so the
 * top eighth of the source is the only thing lost, which on a full-bleed leader
 * illustration is empty background above the head.
 */
function drawAperture(
  ctx: CanvasRenderingContext2D,
  card: CardDef,
  state: LeaderPortraitState,
  metal: Metal
): void {
  const palette = CURRENT_PALETTE[card.current as CurrentId];
  const window_ = archPath();

  /**
   * The collar: a ring of the plaque's own metal around the window, so the arch
   * is *trimmed* rather than being a hole punched in a slab. It is the piece the
   * reference's hero arch spends most of its pixels on and the piece a flat
   * outline version has never had.
   */
  const collar = new Path2D();
  collar.addPath(archPath(-11));
  collar.addPath(window_);
  const collarBounds: Rect = {
    x: ARCH_BOUNDS.x - 11,
    y: ARCH_BOUNDS.y - 11,
    w: ARCH_BOUNDS.w + 22,
    h: ARCH_BOUNDS.h + 22,
  };
  castShadow(ctx, archPath(-11), 4, 0.5);
  ctx.save();
  ctx.fillStyle = bandFace(ctx, collarBounds, metal, 1.15);
  ctx.fill(collar, "evenodd");
  ctx.lineWidth = 2;
  ctx.strokeStyle = edgeGradient(ctx, collarBounds, 0.5, 0.7);
  ctx.stroke(archPath(-11));
  ctx.restore();
  grainOver(ctx, collar, 0.9, "evenodd");

  ctx.save();
  ctx.clip(window_);

  const art = state.art ?? getCardArt(card);
  if (art) {
    const iw = "width" in art ? art.width : ARCH_BOUNDS.w;
    const ih = "height" in art ? art.height : ARCH_BOUNDS.h;
    const scale = Math.max(ARCH_BOUNDS.w / iw, ARCH_BOUNDS.h / ih) * 1.04;
    const dw = iw * scale;
    const dh = ih * scale;
    // anchor near the top: a portrait's head is in its upper third and the
    // arch's dome is the one place a mask can afford to take a little
    const dy = ARCH_BOUNDS.y - (dh - ARCH_BOUNDS.h) * 0.12;
    ctx.drawImage(art as CanvasImageSource, ARCH.cx - dw / 2, dy, dw, dh);
  } else {
    drawPlaceholderArt(ctx, ARCH_BOUNDS, card.current, card.name, {
      faction: card.faction,
      disclosure: { cx: ARCH.cx, y: ARCH_BOUNDS.y + ARCH_BOUNDS.h * 0.62, width: ARCH_BOUNDS.w * 0.86 },
    });
  }

  // a touch of the Current's colour so leaders still read elementally
  ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = hexToRgba(palette.key, 0.12);
  ctx.fillRect(0, 0, LEADER_W, LEADER_H);
  ctx.globalCompositeOperation = "source-over";

  // and a floor under the portrait so the banner has something to sit against
  const scrim = ctx.createLinearGradient(0, ARCH.bottom - 90, 0, ARCH.bottom);
  scrim.addColorStop(0, "rgba(0,0,0,0)");
  scrim.addColorStop(1, hexToRgba(palette.abyss, 0.78));
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, LEADER_W, LEADER_H);
  ctx.restore();

  // the aperture's own bezel: a dark reveal, then the wall of the cut, lit
  ctx.save();
  ctx.lineWidth = 7;
  ctx.strokeStyle = mix(palette.abyss, "#000000", 0.45);
  ctx.stroke(window_);
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = edgeGradient(ctx, ARCH_BOUNDS, 0.34, 0.78, true);
  ctx.stroke(window_);
  ctx.restore();

  // ...and the wall's shadow falling across the picture it surrounds
  innerCast(ctx, window_, ARCH_BOUNDS, { blur: 13, alpha: 0.6, lift: 6, tone: "dark", away: true });
}

// ---------------------------------------------------------------------------
// The plaque
// ---------------------------------------------------------------------------

export function renderLeaderPortrait(
  ctx: CanvasRenderingContext2D,
  card: CardDef,
  state: LeaderPortraitState
): void {
  const current = card.current as CurrentId;
  const palette = CURRENT_PALETTE[current];
  refreshCardStyle();
  ctx.clearRect(0, 0, LEADER_W, LEADER_H);

  const paths = plaquePaths(current);
  const outer = paths.outer;
  const shelf = shelfPath(current);
  const inner = paths.inner;
  const bounds: Rect = PLATE;
  /**
   * The plaque is cut from a legendary card's alloy, not from the raw palette.
   *
   * It used to take `palette.hi/key/lo/abyss` straight, which is the *unranked*
   * Current — so a leader sat above a hand of cards whose frames were all gilded
   * or platinumed by `frameMetal` and was the one object on the board still
   * wearing flat hue. A leader is a deck's single legendary; asking for the
   * legendary rank is both the correct claim and the thing that puts it in the
   * same material family as everything under it.
   */
  const metal: Metal = frameMetal(current, "legendary");

  // --- the plaque sits on the mat, so it casts before it is drawn -----------
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(CX, PLATE.y + PLATE.h + 10, 168, 13, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.34)";
  ctx.shadowColor = "rgba(0,0,0,0.34)";
  ctx.shadowBlur = 16;
  ctx.fill();
  ctx.restore();
  castShadow(ctx, outer, 7, 0.5);

  // --- targeting glow: traces the plaque, every cut and all -----------------
  if (state.highlight === "target") {
    ctx.save();
    ctx.shadowColor = "#ff5f7a";
    ctx.shadowBlur = 22;
    ctx.strokeStyle = "#ff5f7a";
    ctx.lineWidth = 7;
    ctx.stroke(framePath(palette.shape, { x: PLATE.x - 5, y: PLATE.y - 5, w: PLATE.w + 10, h: PLATE.h + 10 }));
    ctx.restore();
  }

  /**
   * The value structure, which is the half of this the first rebuild got wrong.
   *
   * Filling the whole plaque with the Current's metal produced a four-hundred
   * pixel field of one saturated hue with a portrait hole in it — technically lit
   * from 315° and, when you squint at it, a blob. The reference is the opposite
   * and always was: **dark carved stone, bright metal trim.** So the band is the
   * Current's metal and everything inside it is a dark slab of the same hue at a
   * twentieth of the value, which is the same division the card face makes
   * between its frame and its artwork.
   */
  ctx.save();
  ctx.clip(outer);

  ctx.fillStyle = bandFace(ctx, bounds, metal);
  ctx.fill(outer);

  ctx.fillStyle = bandShelf(ctx, bounds, metal);
  ctx.fill(shelf);

  // the dark field the arch is cut into
  ctx.fillStyle = litGradient(ctx, bounds, [
    [0, mix(palette.abyss, "#000000", 0.55)],
    [0.5, mix(palette.abyss, palette.lo, 0.24)],
    [1, mix(palette.lo, palette.abyss, 0.42)],
  ]);
  ctx.fill(inner);
  grainOver(ctx, outer, 0.95);

  /**
   * The band's specular, at the epic strength the card frame gives that tier.
   *
   * Clipped to the band rather than the whole plaque, because a highlight that
   * crosses the dark field as well is a light shining *on* the object rather
   * than a reflection *in* its metal, and the difference between those two is
   * exactly the difference between a plaque and a lozenge with a gradient.
   */
  const spec = frameSpecular(metal.hi, "legendary");
  if (spec) {
    specularBand(ctx, paths.band, bounds, { ...spec, width: 0.075, rule: "evenodd" });
  }

  ctx.lineWidth = 2.6;
  ctx.strokeStyle = edgeGradient(ctx, bounds, 0.5, 0.58);
  ctx.stroke(shelf);
  ctx.restore();

  drawChasing(ctx, inner, metal);

  // the wall the band drops down to the field, and the band's shadow on it
  ctx.save();
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = edgeGradient(ctx, bounds, 0.3, 0.78, true);
  ctx.stroke(inner);
  ctx.restore();
  innerCast(ctx, inner, bounds, { blur: 12, alpha: 0.55, lift: 5, tone: "dark", away: true });

  // the outer wall, lit, drawn last so nothing crosses it
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = edgeGradient(ctx, bounds, 0.42, 0.8);
  ctx.stroke(outer);
  ctx.restore();

  drawAperture(ctx, card, state, metal);
  drawCrestPlate(ctx, card, outer, metal);
  drawChips(ctx, outer, state);
  drawBanner(ctx, card, current, metal);

  drawLeaderMotion(ctx, card, state.sheen ?? 0.3);
}

/**
 * The half of the plaque that moves.
 *
 * A specular crossing the metal on the same six-second period every card frame
 * uses, plus the tight coloured rim the card face wears — so a leader and the
 * cards in the hand below it breathe together instead of one of them being a
 * photograph. Kept separate from the static half for the same reason
 * `drawCardMotion` is: it is a clip, a gradient and a stroke, and the rest of the
 * plaque has no business being redrawn to move it.
 */
export function drawLeaderMotion(ctx: CanvasRenderingContext2D, card: CardDef, sheen: number): void {
  const palette = CURRENT_PALETTE[card.current as CurrentId];
  const outer = plaquePaths(card.current as CurrentId).outer;

  ctx.save();
  ctx.clip(outer);
  const travel = (sheen % 1) * (LEADER_W + LEADER_H) * 1.4 - LEADER_H * 0.6;
  const sweep = ctx.createLinearGradient(travel - LEADER_H * 0.75, 0, travel, LEADER_H);
  sweep.addColorStop(0, "rgba(255,255,255,0)");
  sweep.addColorStop(0.46, hexToRgba(palette.hi, 0.16));
  sweep.addColorStop(0.52, hexToRgba("#ffffff", 0.2));
  sweep.addColorStop(0.58, hexToRgba(palette.hi, 0.16));
  sweep.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, LEADER_W, LEADER_H);
  ctx.restore();

  ctx.save();
  ctx.shadowColor = hexToRgba(palette.key, 0.55);
  ctx.shadowBlur = 12;
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = hexToRgba(mix(palette.key, palette.hi, 0.4), 0.62);
  ctx.stroke(outer);
  ctx.restore();
}

/** Render a leader plaque into a canvas; repaints when its art loads. */
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
  canvas.style.width = `${width}px`;
  canvas.style.height = `${width * (LEADER_H / LEADER_W)}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  let sheen = 0.3;

  const paint = (): void => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(scale * dpr, scale * dpr);
    renderLeaderPortrait(ctx, card, { ...state, sheen });
  };
  paint();

  /**
   * The art-loaded crossfade, matching the card face.
   *
   * A leader plaque is the largest single image on the lobby and on the board,
   * and it was the most conspicuous pop in the game: art-pending one frame,
   * painted the next.
   */
  const fadeIn = (): void => {
    crossfadeIn(
      canvas,
      (target) => {
        target.scale(scale * dpr, scale * dpr);
        renderLeaderPortrait(target, card, { ...state, sheen });
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
  const unsubscribeFonts = onCardFontsReady(() => {
    paint();
    unsubscribeFonts();
  });

  /**
   * The leader breathes on the same clock as everything else.
   *
   * It never registered at all, which made the one object that is on screen for
   * the entire match — twice — the only large card surface in the game with zero
   * idle motion. `premium: true` is not a cosmetic claim; it is how the clock's
   * attention scoring is told that this surface outranks a collection tile for
   * one of its slots, which on a battle board with two leaders and six cards it
   * plainly does.
   */
  registerCardSurface({
    canvas,
    premium: true,
    width,
    paint: (motion) => {
      sheen = motion.sheen;
      paint();
    },
  });

  return canvas;
}
