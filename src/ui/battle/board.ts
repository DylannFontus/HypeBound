/**
 * The ground the match is played on.
 *
 * ## The rectangle, and why it was the worst thing in the game
 *
 * This file used to build the mat as `BoxGeometry(21, 0.42, 17.6)` wearing an
 * opaque `MeshStandardMaterial`: four ninety-degree corners, no alpha, no bevel,
 * no feather. Under the old orthographic camera an axis-aligned box projects to
 * an axis-aligned screen rectangle, so the mat could not read as anything but a
 * panel — and it covered roughly 80% of a painted backdrop while doing it. At
 * 1:1 the boundary between the painted city and the mat was a literal one-pixel
 * step from `#1b3a6b` to `#0e1030`, with the mat *darker* than the sky behind
 * it, so it read as a hole punched in the picture rather than as ground lying in
 * it. Four neon rails were then drawn around the outside to "soften" it, which
 * put a crisper boundary exactly where the soft one was supposed to be.
 *
 * Frame 60 of the reference footage is the answer and it is unambiguous: **there
 * is no rectangle anywhere on that screen.** The play surface is an irregular
 * painted island inside a carved rim whose props physically overlap the play
 * area, it is lit with a visible falloff toward its corners, and its rows exist
 * as structure whether or not anything is standing on them.
 *
 * So the mat is now a plane wearing `softMask` as an `alphaMap` — a superellipse
 * alpha falloff with a different feather on every edge and enough erosion that
 * the boundary wanders rather than ramps. The far edge dissolves hardest,
 * because that is where the painted horizon has to take over; the near edge
 * stays the most definite, because that is where the player's own hand meets it.
 * There is no silhouette left to be a rectangle. A soft halo is painted onto the
 * *world* underneath it, so the island has contact with the rooftop rather than
 * simply fading into it.
 *
 * ## Albedo is albedo, and light is light
 *
 * The old table texture baked a centre-out radial gradient into the surface
 * colour, which is why the mat looked lit while being provably uniformly lit:
 * ambient has no direction and a directional light on a flat horizontal plane
 * has a constant N·L, so *every* variation you could see was painted on, and
 * painted from a direction that agreed with nothing else on screen. The gradient
 * is gone. What is left in the canvas is surface — mottled wear, two clumped
 * noise fields, a hex weave, scuff arcs, the stage crest and two carved sockets
 * — and a height field built from the same paths, converted to a normal map, so
 * the weave and the crest actually catch the key light from 315° instead of
 * sliding under it.
 *
 * The one thing still baked is an edge darkening, and that is ambient occlusion
 * rather than a key: it is radially symmetric, it has no direction to disagree
 * with, and the reference's ground is visibly darker at its corners for the same
 * reason.
 *
 * ## …and then nothing was put on it
 *
 * That is where this file stood for a round, and it was the wrong kind of
 * correct. A mat that is feathered, grained and genuinely lit from 315° is still,
 * on its own, sixty per cent of the frame carrying one line and two sockets.
 * Frame 60 of the reference has more than twenty authored objects around its
 * ground — a carved rim, foliage over the lip, a waterfall spilling onto the
 * border, tiki idols, planks, cloth, two hero busts in recessed trays, deck
 * stacks with real thickness, a mana rail. The instruction "let the environment
 * reach onto it" was read as "soften the boundary" when what it actually asks for
 * is *stuff*.
 *
 * So the arena is now bounded and inhabited:
 *
 * - **A rim.** An extruded ring with a bevel, lying around the playable ground,
 *   painted as a scaffold deck: ply, steel corner plates, gaffer tape, hazard
 *   stripes. Its silhouette is deliberately broken by props, because a ring on
 *   its own is a rectangle with rounded corners and §2 is unambiguous about
 *   rectangles.
 * - **A rope light** along the rim's inner lip, vertex-shaded so it is brightest
 *   at the top-left and dies at the bottom-right. A ring of one brightness is
 *   `border: 1px solid` in three dimensions and §1 bans it outright.
 * - **Props** that overhang the lip: two PA stacks at the far corners, road cases
 *   near the player, a coiled cable spilling onto the ground.
 * - **Furniture for each leader** — a deck stack with thickness and a discard
 *   tray with cards lying in it — so the resources are objects rather than
 *   numbers in a corner (§0a).
 * - **A specular crawl** across the mat on a seven-second period, which is the
 *   one thing that makes a large lit surface read as lit rather than as painted.
 *
 * Everything here is canvas-generated and memoised; nothing is fetched.
 */

import * as THREE from "three";
import { BOARD, type QualityTier } from "./scene";
import { LIGHT_RIG, contactShadow, fadeStrip, noiseTexture, softMask } from "../art/texture";
import { cardFont } from "../cardRenderer/material";
import { iconDataUri } from "../art/uiIcons";
import { getSettings } from "../../save/settings";

export interface BoardHandles {
  group: THREE.Group;
  /** world position of a character slot */
  slotPosition: (side: "player" | "enemy", slot: number, slots: number) => THREE.Vector3;
  /** world position of the Nth of `count` tokens in a centred row */
  rowPosition: (side: "player" | "enemy", index: number, count: number) => THREE.Vector3;
  leaderPosition: (side: "player" | "enemy") => THREE.Vector3;
  locationPosition: (side: "player" | "enemy") => THREE.Vector3;
  /** pulse a slot marker (drop targets while dragging a character) */
  setSlotHighlight: (side: "player" | "enemy", slot: number, on: boolean) => void;
  clearSlotHighlights: () => void;
  /**
   * Light the place a dragged card would land, or clear it with a null index.
   *
   * Separate from `setSlotHighlight` because a row is not a set of fixed slots:
   * characters centre themselves, so the socket has to be drawn at the *virtual*
   * position the row will have once the card is in it, which only the caller
   * knows. This is the whole of the board's drag feedback and there was none.
   */
  setDropTarget: (side: "player" | "enemy", index: number | null, count: number) => void;
  update: (elapsed: number) => void;
}

// ---------------------------------------------------------------------------
// Mat dimensions
// ---------------------------------------------------------------------------

/**
 * How far the alpha ramp reaches inward from each edge of the plane, in world
 * units, and therefore how much bigger than the playable ground the plane is.
 *
 * Three different numbers, because the edges have different jobs. The far edge
 * has to hand over to the painted horizon, so it dissolves over three units. The
 * near edge is where the hand overlaps the board and the player needs to know
 * where the ground stops, so it fades over little more than half that. The sides
 * split the difference.
 *
 * They came down by about a third after the first round: a very long fade over a
 * brightly lit painted backdrop stops reading as ground dissolving and starts
 * reading as haze lying over the picture, because a half-transparent dark
 * surface over city neon is simply grey. Shorter fades plus heavy erosion give
 * the same "no edge anywhere" with none of the fog.
 */
const FEATHER = { far: 3.2, near: 1.8, side: 2.2 };

const MAT_WIDTH = BOARD.width + FEATHER.side * 2;
const MAT_DEPTH = BOARD.depth + FEATHER.far + FEATHER.near;
/** The plane is not centred on the board: the far edge eats more of it. */
const MAT_Z = (FEATHER.near - FEATHER.far) / 2;

const TEX_W = 1024;
const TEX_H = Math.round((TEX_W * MAT_DEPTH) / MAT_WIDTH);
/** World units per texture pixel, so a world measurement can be drawn directly. */
const PX = TEX_W / MAT_WIDTH;

/** Texture-space position of a world point on the mat. */
const tx = (worldX: number): number => (worldX + MAT_WIDTH / 2) * PX;
const tz = (worldZ: number): number => (worldZ - MAT_Z + MAT_DEPTH / 2) * PX;

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

function canvas2d(width: number, height: number): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  return element.getContext("2d");
}

/** The grain bitmap module B already made, as a repeating canvas pattern. */
function grainPattern(
  ctx: CanvasRenderingContext2D,
  size: number,
  amount: number,
  seed: number,
  clump: number
): CanvasPattern | null {
  const source = noiseTexture({ size, amount, seed, clump }).image as HTMLCanvasElement | undefined;
  if (!source || !source.width) return null;
  return ctx.createPattern(source, "repeat");
}

/** A rounded rectangle path, in texture pixels. */
function roundedPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** A pointy-top hexagon, the orientation the floor weave uses. */
function hexShape(cx: number, cy: number, radius: number): Path2D {
  const path = new Path2D();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    const px = cx + Math.cos(a) * radius;
    const py = cy + Math.sin(a) * radius;
    if (i === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  }
  path.closePath();
  return path;
}

/** The two row inlays, in texture pixels: [x, y, w, h, r]. */
function rowInlayRects(): [number, number, number, number, number][] {
  const w = (BOARD.slotSpan + BOARD.cardWidth * 0.9) * PX;
  const h = (BOARD.cardHeight + 1.15) * PX;
  const r = 1.5 * PX;
  return [
    [tx(0) - w / 2, tz(BOARD.enemyRowZ) - h / 2, w, h, r],
    [tx(0) - w / 2, tz(BOARD.playerRowZ) - h / 2, w, h, r],
  ];
}

/**
 * Centres of the two location sockets, mirrored so the board is symmetric.
 *
 * A hexagon rather than a rounded rectangle, and at the same orientation as the
 * floor's weave. The rounded-rect version of this read as an unfinished `<div>`
 * with a `1px solid` border in the middle of the arena — which is fair, because
 * that is exactly what it was — and no amount of bevelling rescues a shape whose
 * whole problem is that it is a rectangle. Matching the weave makes it look like
 * a cell of the floor that has been cut out, which is what a socket is.
 *
 * They have moved inboard, from 8.4 to 6.4, and that is a contrast fix rather
 * than a composition one. Measured against the mat beside them the two sockets
 * came back at 1.86:1 and **1.07:1** — a hue shift, not a recess — and a large
 * part of why is that both sat in the outer third of the frame where the
 * vignette is doing its heaviest work. Inboard they are lit by the spot's own
 * pool, and the socket interior is now genuinely darker than the floor rather
 * than merely a different violet.
 */
const SOCKET_X = 6.4;
const SOCKET_R = 1.2;
/** How far up-board the sockets sit from their leader, clear of the row. */
const SOCKET_Z = (side: 1 | -1): number => (side === 1 ? BOARD.playerLeaderZ - 0.5 : BOARD.enemyLeaderZ + 0.5);

// ---------------------------------------------------------------------------
// The arena rim
// ---------------------------------------------------------------------------

/**
 * The carved edge the play area sits inside.
 *
 * Inner boundary just inside the mat's solid region, so the rim's lip lands on
 * ground rather than on the alpha ramp; outer boundary inside the mat's feather,
 * so what shows beyond the rim is the floor dissolving into the painted world
 * rather than a second hard edge. The corner radius is large — a third of the
 * short side — because the one thing frame 60 establishes above everything else
 * is that there is no rectangle anywhere on it.
 */
const RIM = {
  innerW: 20.4,
  innerD: 16.9,
  thickness: 1.55,
  height: 0.46,
  radius: 3.4,
  /** The ring is centred on the mat, not on the origin. */
  z: MAT_Z,
} as const;

const RIM_OUTER_W = RIM.innerW + RIM.thickness * 2;
const RIM_OUTER_D = RIM.innerD + RIM.thickness * 2;

/**
 * Hex cell radius, in texture pixels — about 0.75 world units, which is a third
 * of a card. Large enough that the eye reads a weave rather than a moiré at the
 * far edge of the mat, small enough that a card covers eight of them.
 */
const HEX_R = 30;

// ---------------------------------------------------------------------------
// The mat's albedo
// ---------------------------------------------------------------------------

/**
 * The playing surface, as colour only.
 *
 * Built at the mat's real aspect rather than as a square stretched onto it —
 * the old 1024² canvas on a 21×17.6 face stretched every hexagon 1.19:1
 * horizontally, which is exactly the sort of thing nobody can name and everybody
 * reads as wallpaper.
 */
function makeTableTexture(): THREE.CanvasTexture {
  const ctx = canvas2d(TEX_W, TEX_H);
  if (!ctx) return new THREE.CanvasTexture(document.createElement("canvas"));

  // A dark violet floor. Flat on purpose: the spot light gives it its
  // directional gradient, and a second gradient here would be a second sun.
  ctx.fillStyle = "#201738";
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  /**
   * The ground inside the ground.
   *
   * The mat's silhouette dissolves — that is the point of the alpha mask — but a
   * surface that dissolves and is otherwise one flat value has no *shape*, and
   * the first version of this looked like a dark sheet laid over the picture
   * rather than like a lit floor lying in it. So the playable area is lifted
   * clear of its own surroundings by a wide, heavily blurred superellipse: no
   * edge anywhere, but a definite lighter middle, which is how the reference's
   * ground reads and why you can point at where it stops without being able to
   * find a line.
   */
  ctx.save();
  ctx.filter = "blur(52px)";
  ctx.fillStyle = "rgba(140, 100, 228, 0.6)";
  roundedPath(
    ctx,
    tx(-BOARD.width / 2 + 1.2),
    tz(MAT_Z - BOARD.depth / 2 + 1.4),
    (BOARD.width - 2.4) * PX,
    (BOARD.depth - 2.8) * PX,
    5.4 * PX
  );
  ctx.fill();
  ctx.restore();

  /**
   * Large-scale wear: the same noise generator, clumped hard and blown up, so
   * the floor has patches rather than being one colour.
   *
   * The amount is a tenth of what it started at. Blown up five times, a peak
   * alpha of 0.55 is not grain any more — it is a set of soft white clouds the
   * size of a card, and the first pass at this looked like smoke drifting over
   * the picture rather than dirt lying on a floor. Enlarging a noise field
   * multiplies how much of it the eye integrates, so the amount has to come down
   * by roughly the scale factor.
   */
  const mottle = grainPattern(ctx, 256, 0.14, 0x4d4154, 7);
  if (mottle) {
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.scale(5, 5);
    ctx.fillStyle = mottle;
    ctx.fillRect(0, 0, TEX_W / 5, TEX_H / 5);
    ctx.restore();
  }

  /**
   * Hex weave, at a fifth of the contrast it used to carry.
   *
   * It is in the normal map as well now, and a pattern that is both painted and
   * modelled lands twice — the first attempt at this was legible as bubble wrap
   * from across the room. Etched, not printed: what should be visible is that
   * the floor has a grain, not what the grain is.
   */
  ctx.strokeStyle = "rgba(186, 162, 255, 0.05)";
  ctx.lineWidth = 1.4;
  hexPath(ctx, HEX_R, (path) => ctx.stroke(path));

  /**
   * Row inlays: a shallow darker band per row, so the board has a structure
   * whether or not anything is standing on it.
   *
   * Blurred by twenty-two pixels, which is the whole trick. Drawn crisply these
   * are two enormous rounded rectangles across the middle of the screen, and
   * "there is no rectangle anywhere on that screen" is the one thing the
   * reference frame establishes above all others. Blurred, the row still reads
   * as a band you could point at and there is no edge to find.
   */
  for (const [x, y, w, h, r] of rowInlayRects()) {
    ctx.save();
    ctx.filter = "blur(22px)";
    roundedPath(ctx, x, y, w, h, r);
    ctx.fillStyle = "rgba(9, 4, 22, 0.3)";
    ctx.fill();
    ctx.restore();
  }

  drawStageCrest(ctx, "rgba(210, 190, 255, 0.14)", "rgba(6, 3, 16, 0.1)");
  drawScuffs(ctx, "rgba(214, 196, 255, 0.075)");

  /**
   * The two location sockets, cut out of the weave rather than tinted onto it.
   *
   * The fill is opaque and very nearly black. It used to be `rgba(6,3,16,0.5)`
   * over a floor already at `#201738`, which arrives at a colour within seven per
   * cent luminance of its surroundings — measured at 1.07:1 on the player's side,
   * against a 3:1 floor for any non-text element. A hole is a hole because no
   * light reaches the bottom of it, so this is painted as no light reaching the
   * bottom of it, with a short gradient down the far wall where the key does
   * still land.
   */
  for (const side of [-1, 1] as const) {
    const cx = tx(SOCKET_X * side);
    const cy = tz(SOCKET_Z(side));
    const r = SOCKET_R * PX;
    ctx.save();
    const shape = hexShape(cx, cy, r);
    ctx.fillStyle = "#050310";
    ctx.fill(shape);
    ctx.clip(shape);
    // The far wall: lit where the key reaches past the near lip, which for a
    // 315° key is the bottom-right quadrant of the well.
    const wall = ctx.createLinearGradient(
      cx + LIGHT_RIG.screen.x * r,
      cy + LIGHT_RIG.screen.y * r,
      cx - LIGHT_RIG.screen.x * r,
      cy - LIGHT_RIG.screen.y * r
    );
    wall.addColorStop(0, "rgba(0,0,0,0)");
    wall.addColorStop(0.55, "rgba(96, 74, 158, 0.05)");
    wall.addColorStop(1, "rgba(150, 122, 220, 0.3)");
    ctx.fillStyle = wall;
    ctx.fill(shape);
    ctx.restore();
  }

  // Dirt. Fine grain at the amount §1 asks for, over everything above.
  const dirt = grainPattern(ctx, 128, 0.16, 0x48594245, 0.6);
  if (dirt) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = dirt;
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    ctx.restore();
  }

  /**
   * The environment reaching onto the floor, and then the edge occlusion — in
   * that order, which is not the order they were written in and is the reason
   * the mat spent a round looking like fog.
   *
   * The tints are the painted world's own light landing on the ground, warm from
   * the city side at the top-left and cool from the rival's, which is what "let
   * the environment reach onto it" means when the environment is a photograph
   * and the mat is geometry. The darkening is symmetric ambient occlusion — no
   * direction, so nothing to disagree with the key. Painted the other way round,
   * the warm wash landed on top of the occlusion and re-lit precisely the corners
   * the occlusion had just put into shadow, and the mat's whole left side came
   * back as a pale haze lying over the picture.
   */
  const warm = ctx.createRadialGradient(TEX_W * 0.16, TEX_H * 0.1, 0, TEX_W * 0.16, TEX_H * 0.1, TEX_W * 0.62);
  warm.addColorStop(0, "rgba(255, 176, 116, 0.15)");
  warm.addColorStop(1, "rgba(255, 176, 116, 0)");
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  const cool = ctx.createRadialGradient(TEX_W * 0.9, TEX_H * 0.86, 0, TEX_W * 0.9, TEX_H * 0.86, TEX_W * 0.5);
  cool.addColorStop(0, "rgba(96, 190, 255, 0.1)");
  cool.addColorStop(1, "rgba(96, 190, 255, 0)");
  ctx.fillStyle = cool;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  const occlusion = ctx.createRadialGradient(
    TEX_W / 2,
    TEX_H * 0.46,
    TEX_W * 0.18,
    TEX_W / 2,
    TEX_H * 0.46,
    TEX_W * 0.66
  );
  occlusion.addColorStop(0, "rgba(0,0,0,0)");
  occlusion.addColorStop(0.46, "rgba(4, 2, 12, 0.15)");
  occlusion.addColorStop(0.76, "rgba(3, 1, 9, 0.5)");
  occlusion.addColorStop(1, "rgba(2, 1, 6, 0.82)");
  ctx.fillStyle = occlusion;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  const texture = new THREE.CanvasTexture(ctx.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * The mark at the centre of the floor, and the reason a big empty surface needs
 * one.
 *
 * With the rectangle gone, the mat's remaining failure was the opposite one: a
 * twenty-unit field of a single value with a faint weave on it, which squints
 * down to one flat mass. Every board in the comparison set puts something in the
 * middle of its ground — Hearthstone a painted seal, MTG Arena an inlaid sigil,
 * Gwent a carved compass — because a large surface with no focal mark reads as
 * unfinished no matter how well it is lit.
 *
 * Hexagons rather than circles, so it belongs to the same floor as the weave and
 * the sockets, and at 5% contrast so it is furniture the eye finds on the second
 * look rather than a logo. `light` engraves the strokes; `dark` sinks the plate
 * they sit on.
 */
function drawStageCrest(ctx: CanvasRenderingContext2D, light: string, dark: string): void {
  const cx = tx(0);
  const cy = tz(0);
  const r = 4.6 * PX;

  ctx.save();
  ctx.translate(cx, cy);

  // The plate: a soft sunk disc, so the crest sits *in* the floor.
  ctx.save();
  ctx.filter = "blur(26px)";
  ctx.fillStyle = dark;
  ctx.fill(hexShape(0, 0, r * 1.06));
  ctx.restore();

  // Blurred, because the strokes are carved into stone rather than plotted: at
  // one hard pixel the crest reads as a vector overlay sitting on the floor
  // instead of as something cut into it.
  ctx.filter = "blur(2px)";
  ctx.strokeStyle = light;
  ctx.lineWidth = 2.6;
  ctx.stroke(hexShape(0, 0, r));
  ctx.lineWidth = 1.6;
  ctx.stroke(hexShape(0, 0, r * 0.82));
  ctx.stroke(hexShape(0, 0, r * 0.3));

  // Radial ticks on the twelve compass points of a hex lattice: long at the
  // vertices, short between them, which is what stops a ring of equal marks
  // from reading as a dial.
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI / 6) * i - Math.PI / 2;
    const long = i % 2 === 0;
    const from = r * (long ? 0.84 : 0.9);
    const to = r * (long ? 0.99 : 0.95);
    ctx.lineWidth = long ? 3 : 1.6;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * from, Math.sin(a) * from);
    ctx.lineTo(Math.cos(a) * to, Math.sin(a) * to);
    ctx.stroke();
  }

  // The mark itself: the house diamond, the same shape the card backs wear.
  const d = r * 0.2;
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(0, -d);
  ctx.lineTo(d * 0.7, 0);
  ctx.lineTo(0, d);
  ctx.lineTo(-d * 0.7, 0);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/**
 * Where the floor has been walked on.
 *
 * Arcs rather than blobs, because wear on a floor follows the paths feet take,
 * and a set of long shallow curves is the cheapest thing that reads as "people
 * have been standing here" rather than as noise. Fixed offsets rather than a
 * random scatter, so two builds of the game produce the same floor and a visual
 * diff shows only what changed.
 */
function drawScuffs(ctx: CanvasRenderingContext2D, colour: string): void {
  const arcs: [number, number, number, number, number][] = [
    [-5.4, -3.1, 4.2, 0.2, 2.1],
    [5.9, -2.2, 3.4, 3.4, 5.6],
    [-6.8, 2.6, 5.1, 4.4, 6.2],
    [6.2, 3.4, 4.6, 1.1, 3.0],
    [0.4, -5.6, 6.2, 0.5, 2.4],
    [-1.2, 5.2, 5.4, 3.6, 5.4],
  ];
  ctx.save();
  ctx.filter = "blur(5px)";
  ctx.strokeStyle = colour;
  ctx.lineCap = "round";
  for (const [x, z, radius, from, to] of arcs) {
    ctx.lineWidth = 3 + (radius % 2) * 2;
    ctx.beginPath();
    ctx.arc(tx(x), tz(z), radius * PX, from, to);
    ctx.stroke();
  }
  ctx.restore();
}

/** Walk the hex lattice once; the callback decides what to do with each cell. */
function hexPath(ctx: CanvasRenderingContext2D, radius: number, draw: (path: Path2D) => void): void {
  const stepY = radius * 1.5;
  const stepX = radius * Math.sqrt(3);
  for (let row = 0; row * stepY < TEX_H + radius; row++) {
    for (let col = 0; col * stepX < TEX_W + radius; col++) {
      const cx = col * stepX + (row % 2) * (stepX / 2);
      const cy = row * stepY;
      const path = new Path2D();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        const px = cx + Math.cos(a) * radius;
        const py = cy + Math.sin(a) * radius;
        if (i === 0) path.moveTo(px, py);
        else path.lineTo(px, py);
      }
      path.closePath();
      draw(path);
    }
  }
}

/**
 * A normal map for the same surface, from the same paths.
 *
 * Drawn as a height field — white is proud, black is sunk — blurred so the
 * ridges have shoulders rather than cliffs, then differenced into a tangent
 * space normal. Without this the hex weave is a painted pattern that the two
 * practicals slide across without ever catching anything, which is precisely the
 * difference §1 draws between texture and wallpaper.
 *
 * Half resolution: a normal map carries direction, not detail, and the eye
 * cannot find the interpolation on a surface this large.
 */
function makeTableNormalMap(): THREE.CanvasTexture | null {
  const w = TEX_W / 2;
  const h = Math.round(TEX_H / 2);
  const heightCtx = canvas2d(w, h);
  if (!heightCtx) return null;

  heightCtx.save();
  heightCtx.scale(0.5, 0.5);
  heightCtx.fillStyle = "#808080";
  heightCtx.fillRect(0, 0, TEX_W, TEX_H);

  // Hex ridges stand slightly proud of the floor.
  heightCtx.strokeStyle = "rgba(255,255,255,0.34)";
  heightCtx.lineWidth = 2.6;
  hexPath(heightCtx, HEX_R, (path) => heightCtx.stroke(path));

  /**
   * The rows are *not* in here, and that is the second time this file has had
   * to learn the same lesson.
   *
   * A lip around the row inlay is the textbook way to make a recess read, and
   * with the key light at 315° it worked perfectly: a crisp lit ridge tracing a
   * nineteen-unit rounded rectangle across the middle of the arena, which is
   * precisely the shape the whole redesign exists to delete. The band survives
   * as a soft darkening in the albedo, where it has no edge to catch anything.
   *
   * Sockets are the exception: they are meant to look cut, they are hexagons
   * rather than rectangles, and they are small enough to read as furniture.
   */
  // The centre crest is carved, so the key light finds it at a glancing angle
  // and the mark appears and disappears as the camera drifts. That is most of
  // what makes it read as cut stone rather than as a decal.
  drawStageCrest(heightCtx, "rgba(255,255,255,0.7)", "rgba(0,0,0,0.22)");

  // Sockets, likewise, but deeper — these are meant to look cut.
  for (const side of [-1, 1] as const) {
    const cx = tx(SOCKET_X * side);
    const cy = tz(SOCKET_Z(side));
    heightCtx.lineWidth = 5;
    heightCtx.strokeStyle = "rgba(255,255,255,0.6)";
    heightCtx.stroke(hexShape(cx, cy, SOCKET_R * PX));
    heightCtx.fillStyle = "rgba(0,0,0,0.5)";
    heightCtx.fill(hexShape(cx, cy, SOCKET_R * PX - 5));
  }
  heightCtx.restore();

  // Shoulders. Without the blur every ridge is a one-pixel cliff and the map
  // aliases into sparkle the moment the camera drifts.
  const blurred = canvas2d(w, h);
  if (!blurred) return null;
  blurred.filter = "blur(2.4px)";
  blurred.drawImage(heightCtx.canvas, 0, 0);
  blurred.filter = "none";

  const source = blurred.getImageData(0, 0, w, h).data;
  const out = blurred.createImageData(w, h);
  const pixels = out.data;
  /**
   * How steep the map reads.
   *
   * This shipped at 2.4 for exactly one screenshot, and the mat came back as
   * bubble wrap: a hex weave that is *also* a height field lands twice, and at
   * that gain the ridges caught the spot light hard enough to turn every cell
   * into a lit pillow. 0.8 is the amount at which the weave exists as a grain
   * and stops being a subject.
   */
  const strength = 0.8;
  const at = (x: number, y: number): number => {
    const cx = x < 0 ? 0 : x >= w ? w - 1 : x;
    const cy = y < 0 ? 0 : y >= h ? h - 1 : y;
    return source[(cy * w + cx) * 4]! / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      // Normalise (-dx, -dy, 1) into the 0..1 range a tangent-space map stores.
      const length = Math.hypot(dx, dy, 1);
      const p = (y * w + x) * 4;
      pixels[p] = Math.round(((-dx / length) * 0.5 + 0.5) * 255);
      pixels[p + 1] = Math.round(((-dy / length) * 0.5 + 0.5) * 255);
      pixels[p + 2] = Math.round((1 / length) * 0.5 * 255 + 127.5);
      pixels[p + 3] = 255;
    }
  }
  blurred.putImageData(out, 0, 0);

  const texture = new THREE.CanvasTexture(blurred.canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * Where the floor is glossy and where it is not.
 *
 * One value across a whole surface is the other half of "mathematically
 * smooth": a real floor is polished where people walk and dull where the dirt
 * has settled, and the difference is what makes a moving highlight crawl rather
 * than slide. Reuses the mottle field so the gloss patches agree with the wear
 * patches instead of being a second, unrelated pattern.
 */
function makeTableRoughnessMap(): THREE.CanvasTexture | null {
  const w = TEX_W / 2;
  const h = Math.round(TEX_H / 2);
  const ctx = canvas2d(w, h);
  if (!ctx) return null;
  ctx.fillStyle = "#c2c2c2";
  ctx.fillRect(0, 0, w, h);
  const mottle = grainPattern(ctx, 256, 0.85, 0x4d4154, 7);
  if (mottle) {
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.scale(2, 2);
    ctx.fillStyle = mottle;
    ctx.fillRect(0, 0, w / 2, h / 2);
    ctx.restore();
  }
  /**
   * The rows are walked on, so they are the polished part — blurred by the same
   * amount the albedo band is, for the same reason and after the same mistake.
   *
   * Drawn crisply this is invisible in the texture and glaringly obvious on
   * screen: a rounded-rectangle patch of *lower roughness* is a rounded-rectangle
   * specular highlight the moment a light crosses it, and the key light crosses
   * it at 315° every frame. The mat came back with a pale rounded rectangle in
   * its upper-left quadrant and it took a while to work out that the shape was
   * being drawn by the gloss map rather than by anything you could see in it.
   */
  ctx.save();
  ctx.filter = "blur(11px)";
  for (const [x, y, rw, rh, r] of rowInlayRects()) {
    roundedPath(ctx, x / 2, y / 2, rw / 2, rh / 2, r / 2);
    ctx.fillStyle = "rgba(150, 150, 150, 0.3)";
    ctx.fill();
  }
  ctx.restore();
  const texture = new THREE.CanvasTexture(ctx.canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/**
 * The mat's own shadow on the world: opaque in the middle, gone by the edge.
 *
 * Painted as a superellipse rather than a radial so its falloff follows the same
 * curve the mat's alpha mask does — a circular halo under a squarish mat leaves
 * the corners uncovered and the middle of each side over-darkened, and the eye
 * finds that as a diamond.
 */
function makeHaloTexture(): THREE.CanvasTexture {
  const size = 256;
  const ctx = canvas2d(size, size);
  if (!ctx) return new THREE.CanvasTexture(document.createElement("canvas"));
  const image = ctx.createImageData(size, size);
  const pixels = image.data;
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = Math.abs((x + 0.5 - half) / half);
      const ny = Math.abs((y + 0.5 - half) / half);
      // Superellipse radius, exponent 3.2 — the mask's shape, normalised.
      const r = Math.pow(Math.pow(nx, 3.2) + Math.pow(ny, 3.2), 1 / 3.2);
      const t = Math.min(1, Math.max(0, 1 - r));
      // Smootherstep, then squared: a soft shoulder in the middle and a long
      // tail, which is what a large soft shadow actually looks like.
      const ramp = t * t * t * (t * (t * 6 - 15) + 10);
      const p = (y * size + x) * 4;
      pixels[p] = 255;
      pixels[p + 1] = 255;
      pixels[p + 2] = 255;
      pixels[p + 3] = Math.round(Math.pow(ramp, 1.4) * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(ctx.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ---------------------------------------------------------------------------
// The rim, the rope light and the props standing on them
// ---------------------------------------------------------------------------

/** A rounded rectangle as a `Shape`/`Path`, centred on the origin. */
function roundedOutline(path: THREE.Shape | THREE.Path, w: number, d: number, r: number): void {
  const hw = w / 2;
  const hd = d / 2;
  const rr = Math.min(r, hw, hd);
  path.moveTo(-hw + rr, -hd);
  path.lineTo(hw - rr, -hd);
  path.quadraticCurveTo(hw, -hd, hw, -hd + rr);
  path.lineTo(hw, hd - rr);
  path.quadraticCurveTo(hw, hd, hw - rr, hd);
  path.lineTo(-hw + rr, hd);
  path.quadraticCurveTo(-hw, hd, -hw, hd - rr);
  path.lineTo(-hw, -hd + rr);
  path.quadraticCurveTo(-hw, -hd, -hw + rr, -hd);
}

/** A flat ring between two rounded rectangles. */
function ringShape(outerW: number, outerD: number, innerW: number, innerD: number, radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  roundedOutline(shape, outerW, outerD, radius);
  const hole = new THREE.Path();
  roundedOutline(hole, innerW, innerD, Math.max(0.2, radius - (outerW - innerW) / 2));
  shape.holes.push(hole);
  return shape;
}

/**
 * Paint a 315° falloff into a geometry's vertex colours.
 *
 * The reason this exists rather than a texture: a closed ring of one brightness
 * is a `border: 1px solid` drawn in three dimensions, which §1 bans by name, and
 * a rope light is exactly the object most likely to become one. Shading it by
 * position means the top-left of the ring is hot and the bottom-right is nearly
 * out, which is what the same light does to every bevel and every chip in the
 * DOM beside it.
 *
 * Ground-plane only: `x` and `z` against the rig's ground vector. Height plays
 * no part, because at a 15° camera tilt nothing on this board is tall enough for
 * it to read.
 */
function shadeAlongKey(geometry: THREE.BufferGeometry, lo: number, hi: number): void {
  const position = geometry.getAttribute("position");
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return;
  const spanX = Math.max(1e-3, box.max.x - box.min.x);
  const spanZ = Math.max(1e-3, box.max.z - box.min.z);
  // Toward the light, on the ground: -x and -z for a 315° key.
  const gx = LIGHT_RIG.world.x;
  const gz = LIGHT_RIG.world.z;
  const scale = 1 / Math.max(1e-3, Math.hypot(gx, gz)) / 2;
  const colours = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const nx = ((position.getX(i) - box.min.x) / spanX) * 2 - 1;
    const nz = ((position.getZ(i) - box.min.z) / spanZ) * 2 - 1;
    const t = Math.min(1, Math.max(0, (nx * gx + nz * gz) * scale + 0.5));
    const value = lo + (hi - lo) * t;
    colours[i * 3] = value;
    colours[i * 3 + 1] = value;
    colours[i * 3 + 2] = value;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
}

/**
 * The rim's surface: a scaffold deck rather than carved stone.
 *
 * The reference borders its ground in whatever the location is made of — stone
 * on a jungle map, timber on a tavern one — and the equivalent here is the thing
 * a rooftop stage is actually built out of: ply over steel deck, corner plates,
 * bolt heads, gaffer tape and hazard paint that has been walked on. Painted with
 * world-space UVs, so the plank run is the same size at every point on the ring
 * and the corner plates land on the corners.
 */
let rimTexture: THREE.CanvasTexture | null = null;
function makeRimTexture(): THREE.CanvasTexture {
  if (rimTexture) return rimTexture;
  const width = 1024;
  const height = Math.round((width * RIM_OUTER_D) / RIM_OUTER_W);
  const ctx = canvas2d(width, height);
  if (!ctx) return new THREE.CanvasTexture(document.createElement("canvas"));

  const ux = width / RIM_OUTER_W;
  const rx = (worldX: number): number => (worldX + RIM_OUTER_W / 2) * ux;
  const ry = (worldZ: number): number => (worldZ - RIM.z + RIM_OUTER_D / 2) * ux;

  ctx.fillStyle = "#241a3c";
  ctx.fillRect(0, 0, width, height);

  // Ply grain: long shallow streaks along the deck, densest where feet land.
  ctx.save();
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 200; i++) {
    const y = (i / 200) * height + ((i * 37) % 11);
    ctx.strokeStyle = i % 3 === 0 ? "rgba(255,246,255,0.035)" : "rgba(8,4,20,0.06)";
    ctx.lineWidth = 1 + (i % 4) * 0.6;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(width * 0.3, y + ((i * 13) % 7) - 3, width * 0.7, y - ((i * 7) % 9) + 4, width, y);
    ctx.stroke();
  }
  ctx.restore();

  // Deck panel seams, one every two world units, lit on their upper edge.
  ctx.lineCap = "butt";
  for (let x = -RIM_OUTER_W / 2 + 2; x < RIM_OUTER_W / 2; x += 2.4) {
    ctx.strokeStyle = "rgba(4, 2, 12, 0.55)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(rx(x), 0);
    ctx.lineTo(rx(x), height);
    ctx.stroke();
    ctx.strokeStyle = "rgba(226, 210, 255, 0.07)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(rx(x) - 2.4, 0);
    ctx.lineTo(rx(x) - 2.4, height);
    ctx.stroke();
  }

  // Steel corner plates with bolt heads. They land on the four corners because
  // the UVs are world-space, which is the whole reason for doing it this way.
  const plate = 3.6;
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const cx = rx((RIM_OUTER_W / 2 - plate / 2 - 0.35) * sx);
      const cy = ry(RIM.z + (RIM_OUTER_D / 2 - plate / 2 - 0.35) * sz);
      const half = (plate / 2) * ux;
      ctx.save();
      ctx.translate(cx, cy);
      const steel = ctx.createLinearGradient(-half, -half, half, half);
      steel.addColorStop(0, "rgba(190, 176, 226, 0.34)");
      steel.addColorStop(0.5, "rgba(74, 62, 110, 0.28)");
      steel.addColorStop(1, "rgba(10, 5, 24, 0.4)");
      ctx.fillStyle = steel;
      roundedPath(ctx, -half, -half, half * 2, half * 2, 10);
      ctx.fill();
      ctx.strokeStyle = "rgba(232, 220, 255, 0.16)";
      ctx.lineWidth = 2;
      ctx.stroke();
      for (const bx of [-0.62, 0.62]) {
        for (const by of [-0.62, 0.62]) {
          ctx.beginPath();
          ctx.arc(bx * half, by * half, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(216, 202, 255, 0.28)";
          ctx.fill();
          ctx.beginPath();
          ctx.arc(bx * half + 1.4, by * half + 1.4, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(4, 2, 12, 0.35)";
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // Hazard paint on the two side runs — worn, because nobody repaints a stage.
  for (const sx of [-1, 1] as const) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(rx((RIM_OUTER_W / 2 - RIM.thickness * 0.62) * sx - 0.5 * ux), ry(RIM.z - 3.4), RIM.thickness * 0.5 * ux, 6.8 * ux);
    ctx.clip();
    ctx.globalAlpha = 0.42;
    for (let i = -20; i < 30; i++) {
      ctx.fillStyle = i % 2 === 0 ? "#f2c65a" : "#171029";
      ctx.save();
      ctx.translate(rx(0), ry(RIM.z));
      ctx.rotate(-0.6);
      ctx.fillRect(-600 + i * 26, -600, 26, 1400);
      ctx.restore();
    }
    ctx.restore();
  }

  // Gaffer tape: three strips across the deck, one peeling.
  const tape = (x0: number, z0: number, x1: number, z1: number, w: number): void => {
    ctx.save();
    ctx.strokeStyle = "rgba(16, 10, 30, 0.72)";
    ctx.lineWidth = w * ux;
    ctx.lineCap = "square";
    ctx.beginPath();
    ctx.moveTo(rx(x0), ry(z0));
    ctx.lineTo(rx(x1), ry(z1));
    ctx.stroke();
    ctx.strokeStyle = "rgba(214, 200, 255, 0.09)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(rx(x0), ry(z0) - (w * ux) / 2);
    ctx.lineTo(rx(x1), ry(z1) - (w * ux) / 2);
    ctx.stroke();
    ctx.restore();
  };
  tape(-11.2, -6.2, -9.4, -5.4, 0.34);
  tape(9.1, 4.2, 11.4, 3.4, 0.3);
  tape(-2.6, 9.3, -0.4, 9.5, 0.28);

  // Grime in the corners, and the same dirt the floor wears.
  const grime = ctx.createRadialGradient(width * 0.5, height * 0.46, width * 0.2, width * 0.5, height * 0.46, width * 0.7);
  grime.addColorStop(0, "rgba(0,0,0,0)");
  grime.addColorStop(1, "rgba(2, 1, 8, 0.6)");
  ctx.fillStyle = grime;
  ctx.fillRect(0, 0, width, height);

  const dirt = grainPattern(ctx, 128, 0.2, 0x52193b, 0.8);
  if (dirt) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = dirt;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  rimTexture = new THREE.CanvasTexture(ctx.canvas);
  rimTexture.colorSpace = THREE.SRGBColorSpace;
  rimTexture.anisotropy = 8;
  rimTexture.repeat.set(1 / RIM_OUTER_W, 1 / RIM_OUTER_D);
  rimTexture.offset.set(0.5, 0.5);
  return rimTexture;
}

/** The rim, its rope light and the shadow it throws onto the floor. */
function makeRim(): THREE.Object3D {
  const group = new THREE.Group();

  const shape = ringShape(RIM_OUTER_W, RIM_OUTER_D, RIM.innerW, RIM.innerD, RIM.radius + RIM.thickness);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: RIM.height,
    bevelEnabled: true,
    bevelThickness: 0.13,
    bevelSize: 0.17,
    bevelOffset: 0,
    bevelSegments: 2,
    curveSegments: 12,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, RIM.z);

  const deck = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      map: makeRimTexture(),
      color: 0xb6a8d8,
      roughness: 0.82,
      metalness: 0.12,
      envMapIntensity: 0.6,
    })
  );
  deck.renderOrder = 0;
  group.add(deck);

  /**
   * The rope light, in the channel where the deck meets the ground.
   *
   * Additive and vertex-shaded, so the composer's bloom picks up its hot end and
   * leaves the cold one alone. It sits a hair proud of the deck's inner lip
   * rather than on top of it, because a light along the *edge* of a step is what
   * makes the step read as a step.
   */
  const ropeShape = ringShape(RIM.innerW + 0.62, RIM.innerD + 0.62, RIM.innerW - 0.16, RIM.innerD - 0.16, RIM.radius + 0.31);
  const ropeGeometry = new THREE.ShapeGeometry(ropeShape, 12);
  ropeGeometry.rotateX(-Math.PI / 2);
  ropeGeometry.translate(0, RIM.height + 0.008, RIM.z);
  shadeAlongKey(ropeGeometry, 0.1, 1);
  const rope = new THREE.Mesh(
    ropeGeometry,
    new THREE.MeshBasicMaterial({
      color: 0xc99bff,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    })
  );
  rope.renderOrder = 4;
  group.add(rope);

  /**
   * The shadow the deck throws inward onto the floor.
   *
   * Wider on the bottom-right than on the top-left, because that is where the
   * key is not. Painted rather than cast: a shadow map for one static ring is a
   * per-frame depth pass for a thing that never moves.
   */
  const skirtShape = ringShape(RIM.innerW + 0.1, RIM.innerD + 0.1, RIM.innerW - 2.4, RIM.innerD - 2.4, RIM.radius);
  const skirtGeometry = new THREE.ShapeGeometry(skirtShape, 12);
  skirtGeometry.rotateX(-Math.PI / 2);
  skirtGeometry.translate(0, 0.006, RIM.z);
  shadeAlongKey(skirtGeometry, 1, 0.12);
  const skirt = new THREE.Mesh(
    skirtGeometry,
    new THREE.MeshBasicMaterial({
      color: 0x05020e,
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      fog: false,
    })
  );
  skirt.renderOrder = 1;
  group.add(skirt);

  return group;
}

/**
 * A prop's surface: a road case, which is what everything backstage is made of.
 *
 * One bitmap on all six faces of a box. It is not a lie — a flight case really is
 * the same ply, the same ball corners and the same stencil on every face — and it
 * is one texture and one draw call for an object whose job is to break a
 * silhouette rather than to be looked at.
 */
const propTextures = new Map<string, THREE.CanvasTexture>();
function makePropTexture(kind: "case" | "speaker"): THREE.CanvasTexture {
  const hit = propTextures.get(kind);
  if (hit) return hit;
  const size = 256;
  const ctx = canvas2d(size, size);
  const texture = new THREE.CanvasTexture(ctx?.canvas ?? document.createElement("canvas"));
  texture.colorSpace = THREE.SRGBColorSpace;
  propTextures.set(kind, texture);
  if (!ctx) return texture;

  const body = ctx.createLinearGradient(0, 0, size, size);
  body.addColorStop(0, kind === "speaker" ? "#2a2140" : "#332246");
  body.addColorStop(1, "#100a1e");
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, size, size);

  if (kind === "speaker") {
    // A driver grille: concentric perforations, a dust cap, a badge.
    ctx.save();
    ctx.translate(size / 2, size * 0.44);
    ctx.fillStyle = "#0a0616";
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.31, 0, Math.PI * 2);
    ctx.fill();
    for (let r = 10; r < size * 0.3; r += 7) {
      ctx.strokeStyle = `rgba(198, 182, 240, ${0.06 + (r / size) * 0.16})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    const cap = ctx.createRadialGradient(-8, -8, 2, 0, 0, 26);
    cap.addColorStop(0, "rgba(226, 212, 255, 0.5)");
    cap.addColorStop(1, "rgba(8, 4, 18, 0.9)");
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "rgba(255, 95, 162, 0.7)";
    ctx.fillRect(size * 0.3, size * 0.83, size * 0.4, 5);
    ctx.font = cardFont(15, 800);
    ctx.textAlign = "center";
    ctx.letterSpacing = "3px";
    ctx.fillStyle = "rgba(226, 212, 255, 0.42)";
    ctx.fillText("HYPEBOUND", size / 2, size * 0.79);
    ctx.letterSpacing = "0px";
  } else {
    // Ply panel inside a steel frame, with ball corners and a latch.
    ctx.strokeStyle = "rgba(206, 192, 248, 0.2)";
    ctx.lineWidth = 9;
    ctx.strokeRect(13, 13, size - 26, size - 26);
    ctx.strokeStyle = "rgba(6, 3, 16, 0.6)";
    ctx.lineWidth = 3;
    ctx.strokeRect(20, 20, size - 40, size - 40);
    for (const [cx, cy] of [
      [16, 16],
      [size - 16, 16],
      [16, size - 16],
      [size - 16, size - 16],
    ] as const) {
      ctx.fillStyle = "rgba(180, 166, 220, 0.32)";
      ctx.beginPath();
      ctx.arc(cx, cy, 15, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(196, 182, 240, 0.26)";
    ctx.fillRect(size * 0.36, size * 0.46, size * 0.28, size * 0.1);
    ctx.fillStyle = "rgba(4, 2, 12, 0.55)";
    ctx.fillRect(size * 0.36, size * 0.53, size * 0.28, 4);
    ctx.font = cardFont(13, 700);
    ctx.textAlign = "center";
    ctx.letterSpacing = "2.4px";
    ctx.fillStyle = "rgba(226, 212, 255, 0.3)";
    ctx.fillText("STAGE LEFT", size / 2, size * 0.78);
    ctx.letterSpacing = "0px";
  }

  const dirt = grainPattern(ctx, 96, 0.22, 0x7b2d55, 0.7);
  if (dirt) {
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = dirt;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
  }
  texture.needsUpdate = true;
  return texture;
}

/**
 * Everything standing on the rim, and it is standing on it deliberately.
 *
 * Each prop overhangs the deck's inner or outer edge, so the ring's silhouette is
 * interrupted at eight places around its run. That is the job: the reference's
 * rim is legible as a border precisely because rocks, leaves and a waterfall keep
 * crossing it, and an uninterrupted ring would be the rectangle this whole
 * redesign exists to avoid.
 */
function makeProps(): THREE.Object3D {
  const group = new THREE.Group();
  const caseMaterial = new THREE.MeshStandardMaterial({
    map: makePropTexture("case"),
    roughness: 0.78,
    metalness: 0.18,
    envMapIntensity: 0.8,
  });
  const speakerMaterial = new THREE.MeshStandardMaterial({
    map: makePropTexture("speaker"),
    roughness: 0.66,
    metalness: 0.22,
    envMapIntensity: 0.9,
  });

  const put = (
    material: THREE.Material,
    w: number,
    h: number,
    d: number,
    x: number,
    z: number,
    /**
     * Annotated, because `RIM` is `as const` and an unannotated default would
     * narrow this parameter to the literal `0.46` — so stacking anything on top
     * of a prop (`RIM.height + 1.5`) stops compiling.
     */
    y: number = RIM.height,
    yaw = 0
  ): void => {
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    box.position.set(x, y + h / 2, z);
    box.rotation.y = yaw;
    group.add(box);
    const shadow = groundShadow(w * 1.5, d * 1.5, { lift: 8 + h * 3, opacity: 0.45, y: y + 0.01 });
    shadow.position.x = x + h * 0.16;
    shadow.position.z = z + h * 0.26;
    shadow.rotation.z = yaw;
    group.add(shadow);
  };

  const farZ = RIM.z - RIM_OUTER_D / 2 + RIM.thickness * 0.55;
  const nearZ = RIM.z + RIM_OUTER_D / 2 - RIM.thickness * 0.55;
  const sideX = RIM_OUTER_W / 2 - RIM.thickness * 0.5;

  // Two PA stacks at the far corners: a sub with a top box on it. They read as
  // the tallest things on the arena and they bracket the rival's half.
  for (const sx of [-1, 1] as const) {
    put(speakerMaterial, 2.3, 1.5, 1.7, sx * (RIM_OUTER_W / 2 - 2.0), farZ + 0.15, RIM.height, sx * 0.14);
    put(speakerMaterial, 1.9, 1.2, 1.4, sx * (RIM_OUTER_W / 2 - 2.0), farZ + 0.15, RIM.height + 1.5, sx * 0.14);
  }

  // Road cases near the player, stacked two high on one side so the near rim is
  // not a mirror of itself.
  put(caseMaterial, 2.5, 1.05, 1.6, -RIM_OUTER_W / 2 + 2.3, nearZ - 0.1, RIM.height, 0.08);
  put(caseMaterial, 1.7, 0.8, 1.3, -RIM_OUTER_W / 2 + 2.1, nearZ - 0.15, RIM.height + 1.05, -0.22);
  put(caseMaterial, 2.9, 0.9, 1.5, RIM_OUTER_W / 2 - 2.6, nearZ - 0.05, RIM.height, -0.06);

  // Amp heads on the side runs, sitting across the deck so they overhang the
  // inner lip and break the ring.
  put(caseMaterial, 1.5, 0.72, 2.4, -sideX + 0.1, RIM.z - 1.4, RIM.height, 0.04);
  put(caseMaterial, 1.4, 0.6, 2.1, sideX - 0.15, RIM.z + 2.6, RIM.height, -0.05);

  /**
   * The cable run, which is this board's version of the reference's foliage
   * growing over the lip.
   *
   * A painted quad rather than a tube: it has to *lie* over the boundary between
   * the deck and the ground, and a tube would have to be modelled to follow the
   * step. Flat, it crosses the lip and reads as slack cable dropped where the
   * crew left it — which is also the only thing on the board that is allowed to
   * be untidy.
   */
  const cable = new THREE.Mesh(
    new THREE.PlaneGeometry(5.4, 5.4),
    new THREE.MeshBasicMaterial({ map: makeCableTexture(), transparent: true, depthWrite: false, fog: false })
  );
  cable.rotation.x = -Math.PI / 2;
  cable.position.set(-RIM.innerW / 2 - 0.2, RIM.height + 0.012, RIM.z + 4.4);
  cable.renderOrder = 3;
  group.add(cable);

  const cable2 = cable.clone();
  cable2.rotation.z = Math.PI;
  cable2.position.set(RIM.innerW / 2 + 0.3, RIM.height + 0.012, RIM.z - 4.8);
  group.add(cable2);

  return group;
}

/** Slack cable, painted once and used at both ends of the arena. */
let cableTexture: THREE.CanvasTexture | null = null;
function makeCableTexture(): THREE.CanvasTexture {
  if (cableTexture) return cableTexture;
  const size = 256;
  const ctx = canvas2d(size, size);
  if (!ctx) return new THREE.CanvasTexture(document.createElement("canvas"));
  ctx.clearRect(0, 0, size, size);
  const runs: [number, number, number, number, number, number][] = [
    [24, 40, 120, 10, 210, 88],
    [30, 76, 148, 44, 224, 132],
    [18, 150, 96, 210, 200, 186],
  ];
  for (const [x0, y0, cx, cy, x1, y1] of runs) {
    // Shadow first, offset to the bottom-right like everything else here.
    ctx.strokeStyle = "rgba(3, 1, 10, 0.55)";
    ctx.lineWidth = 11;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x0 + 3, y0 + 5);
    ctx.quadraticCurveTo(cx + 3, cy + 5, x1 + 3, y1 + 5);
    ctx.stroke();
    ctx.strokeStyle = "#120c22";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(cx, cy, x1, y1);
    ctx.stroke();
    // The lit top-left side of the cable, which is what makes it round.
    ctx.strokeStyle = "rgba(206, 190, 250, 0.3)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x0 - 2, y0 - 2);
    ctx.quadraticCurveTo(cx - 2, cy - 2, x1 - 2, y1 - 2);
    ctx.stroke();
  }
  cableTexture = new THREE.CanvasTexture(ctx.canvas);
  cableTexture.colorSpace = THREE.SRGBColorSpace;
  return cableTexture;
}

/**
 * The moving highlight. One soft band with a hot core, repeating in u.
 *
 * Skewed, not vertical: a band that crosses the floor parallel to the rows would
 * read as a wipe, and what a real light sweeping a stage does is cross it on the
 * diagonal. The skew is baked into the bitmap so the animation stays a single
 * `offset.x` write per frame.
 */
let sweepTexture: THREE.CanvasTexture | null = null;
function makeSweepTexture(): THREE.CanvasTexture {
  if (sweepTexture) return sweepTexture;
  const w = 512;
  const h = 256;
  const ctx = canvas2d(w, h);
  if (!ctx) return new THREE.CanvasTexture(document.createElement("canvas"));
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w * 0.5, h * 0.5);
  ctx.transform(1, 0, -0.55, 1, 0, 0);
  const band = ctx.createLinearGradient(-w * 0.24, 0, w * 0.24, 0);
  band.addColorStop(0, "rgba(0,0,0,0)");
  band.addColorStop(0.36, "rgba(58, 44, 96, 1)");
  band.addColorStop(0.5, "rgba(150, 126, 214, 1)");
  band.addColorStop(0.64, "rgba(58, 44, 96, 1)");
  band.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = band;
  ctx.fillRect(-w * 0.24, -h, w * 0.48, h * 2);
  ctx.restore();
  sweepTexture = new THREE.CanvasTexture(ctx.canvas);
  sweepTexture.colorSpace = THREE.SRGBColorSpace;
  sweepTexture.wrapS = THREE.RepeatWrapping;
  sweepTexture.wrapT = THREE.ClampToEdgeWrapping;
  return sweepTexture;
}

/** A soft round glow sprite used for slot markers and light pools. */
function makeGlowTexture(): THREE.CanvasTexture {
  const size = 256;
  const ctx = canvas2d(size, size);
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.42)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(ctx.canvas);
  }
  return new THREE.CanvasTexture(document.createElement("canvas"));
}

// ---------------------------------------------------------------------------
// Contact shadows, shared with the cards and the leaders
// ---------------------------------------------------------------------------

/**
 * The quad that stops an object floating.
 *
 * A shadow map is the wrong tool for a dozen flat quads lying on a plane — the
 * old rig allocated a 1024² PCF map, re-rendered it every frame on the high
 * tier, and had *no casters at all* configured anywhere in the tree, so it drew
 * an empty depth buffer per frame and delivered nothing. This is the right tool:
 * one painted soft-ellipse, from module B's `contactShadow`, so the shadow under
 * a board card and the CSS shadow under the panel beside it are the same
 * three-box Gaussian rather than two people's idea of one. It costs nothing on
 * the low tier, which is where it matters most.
 *
 * `lift` is how far above the ground the object sits: it stretches the shadow
 * and softens it, exactly as §1 describes.
 */
export function groundShadow(
  width: number,
  depth: number,
  options: {
    lift?: number;
    opacity?: number;
    y?: number;
    space?: "world" | "card";
    /** "card" is a rounded rectangle; "disc" is a circle, for the medallions. */
    shape?: "card" | "disc";
  } = {}
): THREE.Mesh {
  const lift = options.lift ?? 6;
  const disc = options.shape === "disc";
  /**
   * The shadow has to be the shape of the thing casting it, and this is not a
   * pedantic point: a rounded-rectangle shadow under a circular leader medallion
   * put a visible dark plate behind the coin — the one object on the board that
   * had just been redesigned specifically so it would stop reading as a card.
   */
  const shadow = contactShadow({
    width: 256,
    height: disc ? 256 : Math.round((256 * depth) / width),
    radius: disc ? 128 : 26,
    exponent: disc ? 2 : 4,
    lift,
    opacity: options.opacity ?? 0.42,
  });
  // The texture carries transparent padding around the silhouette, so the quad
  // has to be scaled up by the same proportion or the blur is cropped.
  const growX = shadow.size.width / (shadow.size.width - shadow.padding * 2);
  const growZ = shadow.size.height / (shadow.size.height - shadow.padding * 2);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width * growX, depth * growZ),
    new THREE.MeshBasicMaterial({
      map: shadow.texture,
      transparent: true,
      depthWrite: false,
      opacity: 1,
      color: 0x000000,
      fog: false,
    })
  );
  /**
   * A card object is itself rotated flat, so its local XY plane is already the
   * ground plane and its local +Z is world up. Rotating the shadow again inside
   * it would stand it on edge.
   */
  if (options.space !== "card") {
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = options.y ?? 0.004;
  }
  mesh.renderOrder = 1;
  return mesh;
}

// ---------------------------------------------------------------------------
// Resources as objects: the deck stack and the discard tray
// ---------------------------------------------------------------------------

/**
 * The cut edge of a stack of cards — the side face of the deck box.
 *
 * The reference's deck is not a number in a corner, it is a pile you could pick
 * up, and the single thing that makes a box read as a *pile* is that its side is
 * striped at card-thickness rather than being one flat colour. Twenty-two lines
 * on a 0.3-unit face is about what you see on a real deck at this range.
 */
let deckEdgeTexture: THREE.CanvasTexture | null = null;
function makeDeckEdgeTexture(): THREE.CanvasTexture {
  if (deckEdgeTexture) return deckEdgeTexture;
  const w = 64;
  const h = 128;
  const ctx = canvas2d(w, h);
  if (!ctx) return new THREE.CanvasTexture(document.createElement("canvas"));
  const body = ctx.createLinearGradient(0, 0, 0, h);
  body.addColorStop(0, "#ded2f2");
  body.addColorStop(0.5, "#8c7fae");
  body.addColorStop(1, "#2a2040");
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 22; i++) {
    const y = (i / 22) * h;
    ctx.fillStyle = "rgba(12, 6, 26, 0.42)";
    ctx.fillRect(0, y, w, 1.6);
    ctx.fillStyle = "rgba(255, 250, 255, 0.22)";
    ctx.fillRect(0, y + 1.6, w, 1);
  }
  deckEdgeTexture = new THREE.CanvasTexture(ctx.canvas);
  deckEdgeTexture.colorSpace = THREE.SRGBColorSpace;
  return deckEdgeTexture;
}

/** The back the stacks show. Drawn here rather than imported, to avoid a cycle. */
let deckFaceTexture: THREE.CanvasTexture | null = null;
function makeDeckFaceTexture(): THREE.CanvasTexture {
  if (deckFaceTexture) return deckFaceTexture;
  const w = 200;
  const h = 268;
  const ctx = canvas2d(w, h);
  if (!ctx) return new THREE.CanvasTexture(document.createElement("canvas"));
  const field = ctx.createLinearGradient(0, 0, w, h);
  field.addColorStop(0, "#4a2f7d");
  field.addColorStop(1, "#170e2c");
  ctx.fillStyle = field;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(226, 208, 255, 0.28)";
  ctx.lineWidth = 4;
  roundedPath(ctx, 12, 12, w - 24, h - 24, 12);
  ctx.stroke();
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.strokeStyle = "rgba(226, 208, 255, 0.4)";
  ctx.lineWidth = 5;
  for (const k of [1, 0.62, 0.3]) {
    const d = 52 * k;
    ctx.beginPath();
    ctx.moveTo(0, -d);
    ctx.lineTo(d * 0.7, 0);
    ctx.lineTo(0, d);
    ctx.lineTo(-d * 0.7, 0);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
  const dirt = grainPattern(ctx, 96, 0.2, 0x2f5a11, 0.6);
  if (dirt) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = dirt;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  deckFaceTexture = new THREE.CanvasTexture(ctx.canvas);
  deckFaceTexture.colorSpace = THREE.SRGBColorSpace;
  return deckFaceTexture;
}

/**
 * A deck stack and a discard tray, flanking one leader.
 *
 * Both are real objects with thickness rather than HUD chips in a screen corner,
 * which is §0a's "resources are physical objects" and the last piece of furniture
 * the reference gives a hero that we did not. They are placed with 180° rotational
 * symmetry about the arena centre, so the rival's deck is where yours would be if
 * you were sitting in their chair.
 */
function makeLeaderFurniture(side: "player" | "enemy"): THREE.Object3D {
  const group = new THREE.Group();
  const mirror = side === "player" ? 1 : -1;
  const z = side === "player" ? BOARD.playerLeaderZ : BOARD.enemyLeaderZ;

  // --- the deck ---------------------------------------------------------
  const dw = 1.5;
  const dd = 2.0;
  const dh = 0.34;
  const edge = new THREE.MeshStandardMaterial({
    map: makeDeckEdgeTexture(),
    roughness: 0.6,
    metalness: 0.05,
    envMapIntensity: 0.9,
  });
  const face = new THREE.MeshStandardMaterial({
    map: makeDeckFaceTexture(),
    roughness: 0.44,
    metalness: 0.1,
    envMapIntensity: 1.1,
  });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(dw, dh, dd), [edge, edge, face, edge, edge, edge]);
  deck.position.set(mirror * 3.85, dh / 2 + 0.02, z);
  deck.rotation.y = mirror * 0.07;
  group.add(deck);
  const deckShadow = groundShadow(dw * 1.5, dd * 1.4, { lift: 7, opacity: 0.5, y: 0.014 });
  deckShadow.position.set(mirror * 3.85 + 0.09, 0.014, z + 0.14);
  group.add(deckShadow);

  // --- the discard ------------------------------------------------------
  /**
   * A tray, and the cards are *in* it rather than on it.
   *
   * A well inverts the raised material — inner shadow at the top-left where the
   * near lip cuts the light, faint rim light at the bottom-right where the far
   * wall catches it — so the lip ring is vertex-shaded the opposite way round to
   * the rope light. That inversion is the whole difference between a hole and a
   * button, and getting it backwards is the classic way to draw a button.
   */
  const trayW = 1.85;
  const trayD = 2.35;
  const lipShape = ringShape(trayW, trayD, trayW - 0.34, trayD - 0.34, 0.36);
  const lipGeometry = new THREE.ExtrudeGeometry(lipShape, {
    depth: 0.18,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 1,
    curveSegments: 6,
  });
  lipGeometry.rotateX(-Math.PI / 2);
  lipGeometry.translate(-mirror * 3.85, 0.02, z);
  const lip = new THREE.Mesh(
    lipGeometry,
    new THREE.MeshStandardMaterial({ color: 0x3a2c5c, roughness: 0.7, metalness: 0.16, envMapIntensity: 0.8 })
  );
  group.add(lip);

  const floorGeometry = new THREE.PlaneGeometry(trayW - 0.34, trayD - 0.34);
  floorGeometry.rotateX(-Math.PI / 2);
  floorGeometry.translate(-mirror * 3.85, 0.03, z);
  shadeAlongKey(floorGeometry, 0.32, 0.02);
  group.add(
    new THREE.Mesh(
      floorGeometry,
      new THREE.MeshBasicMaterial({ color: 0x120a24, vertexColors: true, fog: false })
    )
  );

  // Two spent cards lying askew in the tray, dimmed because they are out.
  for (const [i, yaw] of [0.34, -0.18].entries()) {
    const spent = new THREE.Mesh(
      new THREE.PlaneGeometry(1.16, 1.56),
      new THREE.MeshBasicMaterial({
        map: makeDeckFaceTexture(),
        color: 0x6a5c88,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        fog: false,
      })
    );
    spent.rotation.x = -Math.PI / 2;
    spent.rotation.z = yaw;
    spent.position.set(-mirror * 3.85 + (i === 0 ? -0.1 : 0.12), 0.04 + i * 0.012, z + (i === 0 ? 0.08 : -0.1));
    spent.renderOrder = 3;
    group.add(spent);
  }

  return group;
}

// ---------------------------------------------------------------------------
// The location socket's furniture
// ---------------------------------------------------------------------------

/**
 * The plate that says an empty socket is an empty socket.
 *
 * The recess itself is cut into the mat; what this adds is the part a player can
 * read — a lit hexagonal lip at a measurable contrast against the floor, the
 * venue glyph engraved in the middle of the well, and a small tracked label under
 * it. An unlabelled dark hexagon is a smudge; a labelled one is an affordance,
 * and §5 makes an empty state something that has to be designed rather than left.
 *
 * The glyph comes out of module C by way of `iconDataUri`, so the mark in the
 * floor is the same drawing at the same stroke weight as the one in the HUD.
 * There is no `location` id in the set and adding one would mean editing module
 * C's file, which the contract forbids; `mode-tour` is the set's "a place you
 * go" mark and is the honest reuse.
 */
let socketPlateTexture: THREE.CanvasTexture | null = null;
function makeSocketPlateTexture(): THREE.CanvasTexture {
  if (socketPlateTexture) return socketPlateTexture;
  const size = 320;
  const ctx = canvas2d(size, size);
  const texture = new THREE.CanvasTexture(ctx?.canvas ?? document.createElement("canvas"));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  socketPlateTexture = texture;
  if (!ctx) return texture;

  const cx = size / 2;
  const cy = size * 0.44;
  const radius = size * 0.33;
  const lx = LIGHT_RIG.screen.x;
  const ly = LIGHT_RIG.screen.y;

  /**
   * The lip, at an amplitude that measures.
   *
   * The previous rim peaked at `rgba(255,255,255,0.42)` on a material carrying
   * `opacity: 0.3`, which lands at about 13% white over a floor at L*≈30 — the
   * 1.07:1 the audit measured. Opaque, and running from near-black on the shaded
   * side to a bright warm chrome on the lit one, the same edge clears 3:1 with
   * room to spare.
   */
  const lip = ctx.createLinearGradient(cx + lx * radius, cy + ly * radius, cx - lx * radius, cy - ly * radius);
  lip.addColorStop(0, "rgba(2, 1, 8, 0.95)");
  lip.addColorStop(0.38, "rgba(46, 32, 74, 0.8)");
  lip.addColorStop(0.78, "rgba(196, 176, 245, 0.85)");
  lip.addColorStop(1, "rgba(248, 240, 255, 0.98)");
  ctx.lineJoin = "round";
  ctx.lineWidth = 13;
  ctx.strokeStyle = lip;
  ctx.stroke(hexShape(cx, cy, radius));

  // A hairline of shadow outside the lip, so the whole thing is seated.
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(2, 1, 8, 0.5)";
  ctx.stroke(hexShape(cx + 2.5, cy + 2.5, radius + 8));

  // The label plate, tracked out the way `.t-label` is.
  const plateW = size * 0.62;
  const plateH = 34;
  const plateX = cx - plateW / 2;
  const plateY = size * 0.79;
  const plate = ctx.createLinearGradient(plateX, plateY, plateX + plateW * 0.4, plateY + plateH);
  plate.addColorStop(0, "rgba(58, 44, 92, 0.92)");
  plate.addColorStop(1, "rgba(16, 9, 32, 0.92)");
  ctx.fillStyle = plate;
  roundedPath(ctx, plateX, plateY, plateW, plateH, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(226, 212, 255, 0.22)";
  ctx.lineWidth = 1.6;
  roundedPath(ctx, plateX + 0.8, plateY + 0.8, plateW - 1.6, plateH - 1.6, 8);
  ctx.stroke();
  ctx.font = cardFont(17, 700);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.letterSpacing = "3.2px";
  ctx.fillStyle = "rgba(4, 2, 12, 0.85)";
  ctx.fillText("LOCATION", cx + 1, plateY + plateH / 2 + 1.4);
  ctx.fillStyle = "rgba(224, 210, 255, 0.9)";
  ctx.fillText("LOCATION", cx, plateY + plateH / 2);
  ctx.letterSpacing = "0px";

  // The glyph, once it decodes. A `data:` URI is not a network fetch, and if it
  // never arrives the socket still reads as a labelled empty recess.
  if (typeof Image !== "undefined") {
    const glyph = new Image();
    glyph.onload = (): void => {
      const box = radius * 1.05;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.drawImage(glyph, cx - box / 2 + 2, cy - box / 2 + 2, box, box);
      ctx.globalAlpha = 1;
      ctx.restore();
      texture.needsUpdate = true;
    };
    glyph.src = iconDataUri("mode-tour", "#c8b4ff", 96);
  }

  texture.needsUpdate = true;
  return texture;
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

export function createBoard(quality: { shadows: boolean; tier?: QualityTier }): BoardHandles {
  /**
   * The low tier keeps the mat and loses its two data maps.
   *
   * `shadows` is no longer read at all — the shadow map that flag used to switch
   * on had no casters and rendered an empty depth buffer every frame, and it is
   * gone. What the tier still decides is whether the floor is shaded as a
   * *material*: the normal and roughness maps are two more texture fetches per
   * pixel across the largest surface on screen, on the tier that is trying to
   * hold 30fps on a phone, and without the composer's bloom and grade there is
   * far less on screen for them to pay off against.
   */
  const detailed = quality.tier !== "low";
  const group = new THREE.Group();
  const glowTexture = makeGlowTexture();

  // --- the mat --------------------------------------------------------------
  /**
   * One quad, and the silhouette comes entirely from the alpha map.
   *
   * Subdividing it would be the instinct — a big plane, a spot light, surely it
   * needs vertices to shade against — and it would buy nothing: three.js shades
   * a `MeshStandardMaterial` per fragment, spot attenuation included, so the
   * pool of light is computed at every pixel whether the plane has four vertices
   * or forty thousand. The detail that *is* needed is in the normal map.
   */
  const matMask = softMask({
    width: TEX_W,
    height: TEX_H,
    radius: Math.round(4.6 * PX),
    exponent: 3.1,
    feather: Math.round(FEATHER.side * PX),
    edgeFeather: {
      top: Math.round(FEATHER.far * PX),
      bottom: Math.round(FEATHER.near * PX),
      left: Math.round(FEATHER.side * PX),
      right: Math.round(FEATHER.side * PX),
    },
    erode: 0.72,
    seed: 0x48594245,
  });

  /**
   * What makes the mat sit on the rooftop instead of dissolving into it.
   *
   * A feathered edge on its own is not contact — it is the absence of an edge,
   * and over a brightly lit painted backdrop it reads as haze rather than as
   * ground. §1's rule is that anything sitting on anything else casts, and this
   * is that rule at arena scale: a wide, very soft darkening of the *world*
   * around the mat's silhouette, drawn under it and over the backdrop. It costs
   * one quad and it is the difference between an island and a fog bank.
   */
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(MAT_WIDTH * 1.16, MAT_DEPTH * 1.18),
    new THREE.MeshBasicMaterial({
      map: makeHaloTexture(),
      color: 0x04020c,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      fog: false,
    })
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.set(0, -0.02, MAT_Z);
  halo.renderOrder = -1;
  group.add(halo);

  const tableMaterial = new THREE.MeshStandardMaterial({
    map: makeTableTexture(),
    alphaMap: matMask,
    transparent: true,
    depthWrite: false,
    // A club floor is a dielectric. The old 0.38 metalness threw away 38% of
    // the diffuse response in exchange for a specular return that could not
    // happen, because there was no environment map in the build at all.
    roughness: 0.74,
    metalness: 0.06,
    envMapIntensity: 0.7,
  });
  const normalMap = detailed ? makeTableNormalMap() : null;
  if (normalMap) {
    tableMaterial.normalMap = normalMap;
    tableMaterial.normalScale = new THREE.Vector2(0.4, 0.4);
  }
  const roughnessMap = detailed ? makeTableRoughnessMap() : null;
  if (roughnessMap) tableMaterial.roughnessMap = roughnessMap;

  const table = new THREE.Mesh(new THREE.PlaneGeometry(MAT_WIDTH, MAT_DEPTH), tableMaterial);
  table.rotation.x = -Math.PI / 2;
  table.position.set(0, 0, MAT_Z);
  table.renderOrder = 0;
  group.add(table);

  /**
   * The arena seam: one rail, at z = 0, fading to nothing at both ends.
   *
   * There were two centre lines before this, fourteen screen pixels apart, in
   * different colours and different softnesses — a crisp near-white rule baked
   * into the table texture at v=0.5 and a separate soft violet band from a mesh
   * at z = -0.325. Two dividers where the design intends one is the definition
   * of unfinished. The baked one is gone; this is the survivor, and it now has a
   * profile instead of being a flat stroke: a lit lip above, the body, a
   * darkened shadow below, so it reads as a rail pressed into the surface. §7
   * makes the end taper a rule, and `fadeStrip` is the primitive for it.
   */
  const seamCtx = canvas2d(8, 32);
  if (seamCtx) {
    const profile = seamCtx.createLinearGradient(0, 0, 0, 32);
    profile.addColorStop(0, "rgba(0,0,0,0)");
    profile.addColorStop(0.3, "rgba(126, 92, 190, 0.22)");
    profile.addColorStop(0.42, "rgba(226, 200, 255, 0.95)");
    profile.addColorStop(0.5, "rgba(255, 246, 255, 1)");
    profile.addColorStop(0.6, "rgba(150, 110, 220, 0.5)");
    profile.addColorStop(0.72, "rgba(10, 4, 24, 0.55)");
    profile.addColorStop(1, "rgba(0,0,0,0)");
    seamCtx.fillStyle = profile;
    seamCtx.fillRect(0, 0, 8, 32);
  }
  const seamTexture = new THREE.CanvasTexture(seamCtx?.canvas ?? document.createElement("canvas"));
  seamTexture.colorSpace = THREE.SRGBColorSpace;
  const seam = new THREE.Mesh(
    new THREE.PlaneGeometry(BOARD.width + 1.6, 0.34),
    new THREE.MeshBasicMaterial({
      map: seamTexture,
      alphaMap: fadeStrip(0.22, "x").texture,
      color: 0xcfb0ff,
      transparent: true,
      depthWrite: false,
      // Not additive: additive cannot darken, and half of what makes this read
      // as a rail pressed into the floor rather than a stroke drawn on it is
      // the shadow under its lower lip.
      fog: false,
    })
  );
  seam.rotation.x = -Math.PI / 2;
  seam.position.set(0, 0.012, 0);
  seam.renderOrder = 2;
  group.add(seam);

  // --- the rim, and everything standing on it -------------------------------
  group.add(makeRim());
  group.add(makeProps());
  group.add(makeLeaderFurniture("player"));
  group.add(makeLeaderFurniture("enemy"));

  /**
   * The specular crawl: a wide soft band of light sliding across the floor.
   *
   * §3 asks for the screen to be alive at rest and names a gentle specular crawl
   * as one of the three things that do it. This board had nothing — `update()`
   * touched only the slot rings, and only while one was highlighted, so a
   * six-frame burst of an idle arena came back six identical frames.
   *
   * It wears the mat's own alpha mask, so the band cannot spill past the ground
   * onto the painted world, and it is additive, so `SRC_ALPHA` carries that mask
   * straight into the blend. One quad, one moving texture offset.
   */
  const sweepTexture = makeSweepTexture();
  const sweep = new THREE.Mesh(
    new THREE.PlaneGeometry(MAT_WIDTH, MAT_DEPTH),
    new THREE.MeshBasicMaterial({
      map: sweepTexture,
      alphaMap: matMask,
      color: 0xd6c2ff,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    })
  );
  sweep.rotation.x = -Math.PI / 2;
  sweep.position.set(0, 0.007, MAT_Z);
  sweep.renderOrder = 1;
  group.add(sweep);

  // --- slot markers ---------------------------------------------------------
  const slotMarkers = new Map<string, { ring: THREE.Mesh; glow: THREE.Sprite; highlighted: boolean }>();
  const SLOTS = 6;

  /**
   * Where the Nth of `count` tokens sits in a row. Rows stay centred and use a
   * fixed spacing until they would exceed slotSpan, at which point tokens
   * tighten up rather than spilling off the arena — this is what the reference
   * does and it keeps a full board readable.
   */
  const rowPosition = (side: "player" | "enemy", index: number, count: number): THREE.Vector3 => {
    const spacing = Math.min(BOARD.tokenSpacing, BOARD.slotSpan / Math.max(1, count));
    const spread = spacing * Math.max(0, count - 1);
    const x = count > 1 ? -spread / 2 + index * spacing : 0;
    const z = side === "player" ? BOARD.playerRowZ : BOARD.enemyRowZ;
    return new THREE.Vector3(x, 0.02, z);
  };

  const slotPosition = (side: "player" | "enemy", slot: number, slots = SLOTS): THREE.Vector3 =>
    rowPosition(side, slot, slots);

  for (const side of ["player", "enemy"] as const) {
    for (let slot = 0; slot < SLOTS; slot++) {
      const position = slotPosition(side, slot);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.66, 0.75, 48),
        new THREE.MeshBasicMaterial({
          color: side === "player" ? 0x9a6cff : 0x4aa0ff,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
          fog: false,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(position);
      ring.renderOrder = 5;
      group.add(ring);

      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture,
          color: side === "player" ? 0xb56cff : 0x52c8ff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          fog: false,
        })
      );
      glow.scale.set(2.6, 2.6, 1);
      glow.position.set(position.x, 0.06, position.z);
      glow.renderOrder = 6;
      group.add(glow);

      slotMarkers.set(`${side}:${slot}`, { ring, glow, highlighted: false });
    }
  }

  // --- leader podiums -------------------------------------------------------
  const leaderPosition = (side: "player" | "enemy"): THREE.Vector3 =>
    new THREE.Vector3(0, 0.02, side === "player" ? BOARD.playerLeaderZ : BOARD.enemyLeaderZ);

  /**
   * The leader zone is a soft round pool of light, nothing more.
   *
   * It used to be a rectangular glow plate with a bright four-bar outline sized
   * to `cardWidth x cardHeight`. That outline was the single biggest reason the
   * leader read as "a full rectangular card" no matter what shape the portrait
   * itself was: a card-shaped frame around it told the eye "card" before the
   * artwork inside got a chance to say otherwise. A radial falloff with no edge
   * at all cannot draw a rectangle, and it suits a medallion.
   */
  for (const side of ["player", "enemy"] as const) {
    const position = leaderPosition(side);
    const accent = side === "player" ? 0xff5fa2 : 0x52c8ff;

    // A ground-plane mesh rather than a sprite: a sprite would face the camera
    // and the pool has to read as light lying on the arena.
    const pool = new THREE.Mesh(
      // Tight to the medallion. Scaled off `leaderHeight` it grew with the
      // medallion and became a five-unit magenta cloud sitting where the
      // player's own row ends — a soft-brush blob, which is the exact note the
      // audit gave the two point lights.
      new THREE.PlaneGeometry(BOARD.leaderHeight * 1.75, BOARD.leaderHeight * 1.55),
      new THREE.MeshBasicMaterial({
        map: glowTexture,
        color: accent,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(position.x, 0.008, position.z);
    pool.renderOrder = 2;
    group.add(pool);
  }

  // --- location sockets -----------------------------------------------------
  /**
   * Mirrored, at last.
   *
   * Both plinths used to sit on the right-hand side — two empty outlined
   * rectangles stacked in one corner while a quarter of the mat sat empty on the
   * left. They are now one per side, so the composition is balanced, and the
   * socket itself is carved into the mat's albedo and normal map rather than
   * being a translucent quad with a four-segment ring on it. What is left here
   * is the rim light that says the recess has a lip.
   */
  const locationPosition = (side: "player" | "enemy"): THREE.Vector3 =>
    new THREE.Vector3(side === "player" ? SOCKET_X : -SOCKET_X, 0.02, SOCKET_Z(side === "player" ? 1 : -1));

  const socketPlate = makeSocketPlateTexture();
  for (const side of ["player", "enemy"] as const) {
    const position = locationPosition(side);
    const plate = new THREE.Mesh(
      // Taller than it is wide: the plate carries the lip, the glyph AND the
      // label under it, and the label is what turns a dark hexagon into an
      // affordance.
      new THREE.PlaneGeometry(SOCKET_R * 2.9, SOCKET_R * 2.9),
      new THREE.MeshBasicMaterial({
        map: socketPlate,
        // Opaque enough to measure. The old rim ran at 0.3 and could not have
        // cleared 3:1 at any colour.
        transparent: true,
        opacity: 1,
        depthWrite: false,
        fog: false,
      })
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(position.x, 0.012, position.z + SOCKET_R * 0.42);
    plate.renderOrder = 3;
    group.add(plate);
  }

  // --- the drop target ------------------------------------------------------
  /**
   * What a legal slot looks like while a card is over it, and there was none.
   *
   * Diffed six times amplified against a resting frame, a drag over the player's
   * row changed nothing in the row: `update()` read `marker.highlighted`, nothing
   * ever set it during an external drag, and the fixed slot markers would have
   * been in the wrong places anyway because a row centres itself. This is one
   * marker, moved to wherever the card would actually land: a socket ring with
   * the mat's own superellipse falloff, a band of the row inlay raised under it,
   * and a light pool. It is the object the row opens a gap for.
   */
  const dropSocket = new THREE.Mesh(
    new THREE.PlaneGeometry(BOARD.cardWidth * 1.5, BOARD.cardHeight * 1.34),
    new THREE.MeshBasicMaterial({
      map: makeDropSocketTexture(),
      color: 0xc79bff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    })
  );
  dropSocket.rotation.x = -Math.PI / 2;
  dropSocket.position.set(0, 0.026, BOARD.playerRowZ);
  dropSocket.renderOrder = 6;
  dropSocket.visible = false;
  group.add(dropSocket);

  /** The row inlay, lit along its whole length while a card is in the air. */
  const dropBand = new THREE.Mesh(
    new THREE.PlaneGeometry(BOARD.slotSpan + BOARD.cardWidth, BOARD.cardHeight + 1.3),
    new THREE.MeshBasicMaterial({
      map: makeRowBandTexture(),
      color: 0x8f6cff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    })
  );
  dropBand.rotation.x = -Math.PI / 2;
  dropBand.position.set(0, 0.02, BOARD.playerRowZ);
  dropBand.renderOrder = 5;
  dropBand.visible = false;
  group.add(dropBand);

  let dropTarget: { side: "player" | "enemy"; index: number; count: number } | null = null;

  function setDropTarget(side: "player" | "enemy", index: number | null, count: number): void {
    if (index === null) {
      dropTarget = null;
      return;
    }
    dropTarget = { side, index, count };
    const at = rowPosition(side, index, Math.max(1, count));
    dropSocket.position.set(at.x, 0.026, at.z);
    dropBand.position.set(0, 0.02, at.z);
    dropSocket.visible = true;
    dropBand.visible = true;
  }

  // --- api ------------------------------------------------------------------
  function setSlotHighlight(side: "player" | "enemy", slot: number, on: boolean): void {
    const marker = slotMarkers.get(`${side}:${slot}`);
    if (marker) marker.highlighted = on;
  }

  function clearSlotHighlights(): void {
    for (const marker of slotMarkers.values()) marker.highlighted = false;
  }

  /**
   * The one place the arena moves at rest, and the one place it answers a drag.
   *
   * `elapsed` is seconds. Everything decorative here is gated on the reduced
   * motion setting and pinned to its midpoint rather than merely slowed, which is
   * §3's rule: the decorative layer dies, the functional layer lives. The drop
   * feedback is functional and keeps its state; only its throb stops.
   */
  function update(elapsed: number): void {
    const still = getSettings().reducedMotion;

    // The specular crawl. 6.8 seconds for one pass, which is inside §3's 3-8s
    // band and slow enough that it never competes with a card being played.
    sweepTexture.offset.x = still ? 0.25 : (elapsed / 6.8) % 1;

    for (const marker of slotMarkers.values()) {
      // Characters centre themselves on the row rather than snapping to fixed
      // slots, so idle rings would never line up with them. The row inlay in the
      // mat carries the board's shape at rest; these appear only as drop targets
      // while a card is being dragged.
      const throb = still ? 0 : Math.sin(elapsed * 5);
      const targetRing = marker.highlighted ? 0.8 + throb * 0.18 : 0;
      const targetGlow = marker.highlighted ? 0.45 + throb * 0.14 : 0;
      const ringMaterial = marker.ring.material as THREE.MeshBasicMaterial;
      const glowMaterial = marker.glow.material as THREE.SpriteMaterial;
      ringMaterial.opacity += (targetRing - ringMaterial.opacity) * 0.2;
      glowMaterial.opacity += (targetGlow - glowMaterial.opacity) * 0.2;
    }

    const socketMaterial = dropSocket.material as THREE.MeshBasicMaterial;
    const bandMaterial = dropBand.material as THREE.MeshBasicMaterial;
    const breath = still ? 0 : Math.sin(elapsed * 4.4);
    const socketTarget = dropTarget ? 0.82 + breath * 0.16 : 0;
    const bandTarget = dropTarget ? 0.3 + breath * 0.06 : 0;
    socketMaterial.opacity += (socketTarget - socketMaterial.opacity) * 0.28;
    bandMaterial.opacity += (bandTarget - bandMaterial.opacity) * 0.28;
    if (socketMaterial.opacity < 0.005 && !dropTarget) {
      dropSocket.visible = false;
      dropBand.visible = false;
    }
    const pop = dropTarget ? 1 + breath * 0.03 : 1;
    dropSocket.scale.set(pop, pop, 1);
  }

  return {
    group,
    slotPosition,
    rowPosition,
    leaderPosition,
    locationPosition,
    setSlotHighlight,
    clearSlotHighlights,
    setDropTarget,
    update,
  };
}

/**
 * The socket a dragged card is about to land in.
 *
 * Superellipse, with the same exponent and the same feather the mat's own alpha
 * mask uses, because a drop target with a crisp outline is a rectangle drawn on
 * a surface that spent a whole redesign getting rid of them. A bright inner ring
 * with a soft filled well inside it: the ring says "here", the fill says "this
 * much space", which together are what makes placing a minion feel like placing
 * something.
 */
function makeDropSocketTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 320;
  const ctx = canvas2d(w, h);
  if (!ctx) return new THREE.CanvasTexture(document.createElement("canvas"));
  ctx.clearRect(0, 0, w, h);

  const image = ctx.createImageData(w, h);
  const pixels = image.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = Math.abs((x + 0.5 - w / 2) / (w / 2));
      const ny = Math.abs((y + 0.5 - h / 2) / (h / 2));
      const r = Math.pow(Math.pow(nx, 3.1) + Math.pow(ny, 3.1), 1 / 3.1);
      // A wall at r≈0.74 and a soft floor inside it.
      const ring = Math.exp(-Math.pow((r - 0.74) / 0.075, 2));
      const fill = Math.max(0, 1 - Math.pow(r / 0.74, 2.6)) * 0.22;
      const value = Math.min(1, ring + fill);
      const p = (y * w + x) * 4;
      pixels[p] = 255;
      pixels[p + 1] = 246;
      pixels[p + 2] = 255;
      pixels[p + 3] = Math.round(value * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(ctx.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The row inlay, as something that can be lit.
 *
 * It exists in the mat's albedo as a blurred darker band, which is right at rest
 * and useless as feedback — you cannot raise the brightness of a pixel that has
 * already been baked. This is the same band as an additive overlay, tapering to
 * nothing at both ends so it never draws an edge across the arena.
 */
function makeRowBandTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 128;
  const ctx = canvas2d(w, h);
  if (!ctx) return new THREE.CanvasTexture(document.createElement("canvas"));
  ctx.clearRect(0, 0, w, h);
  const across = ctx.createLinearGradient(0, 0, w, 0);
  across.addColorStop(0, "rgba(255,255,255,0)");
  across.addColorStop(0.22, "rgba(255,255,255,0.85)");
  across.addColorStop(0.5, "rgba(255,255,255,1)");
  across.addColorStop(0.78, "rgba(255,255,255,0.85)");
  across.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, w, h);
  const down = ctx.createLinearGradient(0, 0, 0, h);
  down.addColorStop(0, "rgba(0,0,0,1)");
  down.addColorStop(0.16, "rgba(0,0,0,0)");
  down.addColorStop(0.84, "rgba(0,0,0,0)");
  down.addColorStop(1, "rgba(0,0,0,1)");
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = down;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
  const texture = new THREE.CanvasTexture(ctx.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
