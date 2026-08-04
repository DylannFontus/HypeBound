/**
 * A struck badge for every achievement, generated rather than authored.
 *
 * ## Why this exists
 *
 * Every achievement's entire visual identity used to be its point value inside a
 * 30px circle, and every state was the word "Locked", "Unlocked" or "Claimed" in
 * dim grey at the far right — so a category of eight produced a vertical column
 * of the word "Locked" repeated eight times. Xbox, PlayStation and Hearthstone
 * all give an achievement an illustrated badge, desaturated when locked and
 * full-colour with a rim light when earned, and the badge is the reward for
 * looking at the list at all. A repeated grey word is a database column.
 *
 * There is no art budget and there must never be one — the card paintings are
 * hand-made and nothing else in this game may fabricate art into that space — so
 * these are *hardware*, not illustration: a struck plate whose metal, bevel and
 * rim come from the point tier. That is a thing a canvas can genuinely make well,
 * and it improves all fifty-odd achievements at once rather than a few.
 *
 * ## The three metals are the tiers, and they are readable without colour
 *
 * 10, 25 and 50 points are bronze, steel and gold — but the tier is *also* the
 * number stamped in the middle and the number of studs around the rim, because
 * §6's last rule is that nothing is signalled by colour alone and a badge is
 * exactly the kind of thing that quietly breaks it.
 *
 * ## Cost
 *
 * Three tiers times three states is nine bitmaps for the whole game, memoised by
 * key and handed out as `data:` URIs. Fifty rows referencing nine images is fifty
 * cheap `<img>` decodes of an already-decoded texture, where fifty canvases would
 * be fifty rasterisations on every tab change.
 */

import { LIGHT_RIG } from "../../art/texture";

export type BadgeState = "locked" | "unlocked" | "claimed";

interface Metal {
  /** the lit face, at the top-left where the key is */
  hi: string;
  /** the body */
  key: string;
  /** the unlit lip, bottom-right */
  lo: string;
  /** the field the number sits in */
  field: string;
  ink: string;
  name: string;
}

/**
 * Three metals, and one grey.
 *
 * The locked metal is a *different alloy*, not the same one at lower opacity.
 * That distinction is the whole point: fading a badge says "this failed to
 * render", darkening and de-alloying it says "this has not been struck yet".
 */
const BRONZE: Metal = { hi: "#f0c99a", key: "#b8794a", lo: "#54301a", field: "#2a1a12", ink: "#ffe6c8", name: "Bronze" };
const STEEL: Metal = { hi: "#f2f5ff", key: "#a9b4cf", lo: "#3f4760", field: "#1b2030", ink: "#eef2ff", name: "Steel" };
const GOLD: Metal = { hi: "#ffeab4", key: "#e0ab3c", lo: "#6a4510", field: "#2e2210", ink: "#fff3d2", name: "Gold" };
const LEAD: Metal = { hi: "#6a6480", key: "#403c52", lo: "#1a1826", field: "#141220", ink: "#9b93b4", name: "Unstruck" };

/** Which metal a point value is struck in. */
export function badgeMetal(points: number): Metal {
  if (points >= 50) return GOLD;
  if (points >= 25) return STEEL;
  return BRONZE;
}

export const badgeTierName = (points: number): string => badgeMetal(points).name;

const cache = new Map<string, string>();

/** The drawing resolution. 128 CSS px at 2×, which is sharp at every size used. */
const SIZE = 256;

/**
 * A hexagon with a point at the top, in a box.
 *
 * Pointy-top rather than flat-top because a flat-top hexagon at small sizes is
 * hard to tell from a rounded rectangle, and the whole job of the silhouette is
 * to be recognisable at 58px in a list of forty.
 */
function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): Path2D {
  const path = new Path2D();
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();
  void ctx;
  return path;
}

/**
 * The 315° light, as the two endpoints of a linear gradient across a box.
 *
 * Read from `LIGHT_RIG` rather than written as `(0,0) → (w,h)`, so that if the
 * one global light decision ever moves, this moves with it instead of becoming
 * the one badge in the game lit from somewhere else.
 */
function litGradient(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): CanvasGradient {
  const radians = ((LIGHT_RIG.cssAngle - 90) * Math.PI) / 180;
  const dx = Math.cos(radians) * r;
  const dy = Math.sin(radians) * r;
  return ctx.createLinearGradient(cx + dx, cy + dy, cx - dx, cy - dy);
}

function drawBadge(ctx: CanvasRenderingContext2D, points: number, state: BadgeState): void {
  const metal = state === "locked" ? LEAD : badgeMetal(points);
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const outer = hexPath(ctx, cx, cy, SIZE * 0.44);
  const inner = hexPath(ctx, cx, cy, SIZE * 0.33);

  ctx.clearRect(0, 0, SIZE, SIZE);

  // the cast, before the object — a badge sits on the row, it is not printed on it
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.72)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetX = 5 * 0.62;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = "#000";
  ctx.fill(outer);
  ctx.restore();

  // --- the plate ----------------------------------------------------------
  const face = litGradient(ctx, cx, cy, SIZE * 0.44);
  face.addColorStop(0, metal.hi);
  face.addColorStop(0.42, metal.key);
  face.addColorStop(1, metal.lo);
  ctx.fillStyle = face;
  ctx.fill(outer);

  // the bevel: a bright edge where the plate turns into the light, a dark one
  // where it turns away, drawn as one stroke along the same vector
  const rim = litGradient(ctx, cx, cy, SIZE * 0.44);
  rim.addColorStop(0, "rgba(255,255,255,0.85)");
  rim.addColorStop(0.5, "rgba(255,255,255,0.06)");
  rim.addColorStop(1, "rgba(0,0,0,0.6)");
  ctx.lineWidth = SIZE * 0.028;
  ctx.strokeStyle = rim;
  ctx.stroke(outer);

  // --- the field the number is stamped into -------------------------------
  const well = ctx.createRadialGradient(cx - SIZE * 0.08, cy - SIZE * 0.1, SIZE * 0.04, cx, cy, SIZE * 0.34);
  well.addColorStop(0, metal.field);
  well.addColorStop(1, state === "locked" ? "#0b0912" : "#070410");
  ctx.fillStyle = well;
  ctx.fill(inner);

  // the field's own inverted bevel: dark at the top-left, lit at the bottom
  // right, because a recess is lit by the opposite edges to a raised plate
  const groove = litGradient(ctx, cx, cy, SIZE * 0.33);
  groove.addColorStop(0, "rgba(0,0,0,0.75)");
  groove.addColorStop(0.55, "rgba(0,0,0,0.05)");
  groove.addColorStop(1, "rgba(255,255,255,0.22)");
  ctx.lineWidth = SIZE * 0.016;
  ctx.strokeStyle = groove;
  ctx.stroke(inner);

  // --- studs: the tier, said a second way ---------------------------------
  const studs = points >= 50 ? 6 : points >= 25 ? 3 : 1;
  for (let i = 0; i < studs; i += 1) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / studs;
    const sx = cx + Math.cos(angle) * SIZE * 0.385;
    const sy = cy + Math.sin(angle) * SIZE * 0.385;
    const stud = ctx.createRadialGradient(sx - 2, sy - 2, 0.5, sx, sy, SIZE * 0.028);
    stud.addColorStop(0, "rgba(255,255,255,0.95)");
    stud.addColorStop(0.5, metal.hi);
    stud.addColorStop(1, metal.lo);
    ctx.fillStyle = stud;
    ctx.beginPath();
    ctx.arc(sx, sy, SIZE * 0.026, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- the number ---------------------------------------------------------
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // three digits (the 250 and 500 point milestones) have to shrink or they run
  // straight out of the field and into the bevel
  const digits = String(points).length;
  ctx.font = `800 ${SIZE * (digits >= 3 ? 0.2 : 0.27)}px "Chivo", "Segoe UI", system-ui, sans-serif`;
  // engraved: a dark copy offset along the light vector, then the face on top
  ctx.fillStyle = "rgba(0,0,0,0.8)";
  ctx.fillText(String(points), cx + 2, cy + 3);
  ctx.fillStyle = state === "locked" ? metal.ink : metal.hi;
  ctx.fillText(String(points), cx, cy + 1);
  ctx.restore();

  // --- state, on the badge itself -----------------------------------------
  if (state === "locked") lockPlate(ctx, cx, cy + SIZE * 0.31);
  if (state === "claimed") checkPlate(ctx, cx + SIZE * 0.28, cy + SIZE * 0.28);

  // an earned badge catches the light; an unstruck one does not
  if (state !== "locked") {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const bloom = ctx.createRadialGradient(cx - SIZE * 0.14, cy - SIZE * 0.18, 2, cx, cy, SIZE * 0.46);
    bloom.addColorStop(0, "rgba(255,255,255,0.26)");
    bloom.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = bloom;
    ctx.fill(outer);
    ctx.restore();
  }
}

/** The padlock, drawn rather than typed — a Unicode 🔒 is whatever the OS has. */
function lockPlate(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const r = SIZE * 0.1;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  const plate = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  plate.addColorStop(0, "#3a3550");
  plate.addColorStop(1, "#14111f");
  ctx.fillStyle = plate;
  ctx.fill();
  ctx.lineWidth = SIZE * 0.012;
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.stroke();

  ctx.strokeStyle = "#cfc6e6";
  ctx.lineWidth = SIZE * 0.019;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(x, y - r * 0.18, r * 0.36, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = "#cfc6e6";
  const bw = r * 0.92;
  const bh = r * 0.66;
  ctx.beginPath();
  ctx.roundRect(x - bw / 2, y - r * 0.1, bw, bh, r * 0.16);
  ctx.fill();
  ctx.restore();
}

/** The claimed tick, on its own struck disc so it reads as a stamp. */
function checkPlate(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const r = SIZE * 0.115;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  const plate = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  plate.addColorStop(0, "#8ef0b4");
  plate.addColorStop(1, "#1c7a4a");
  ctx.fillStyle = plate;
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "#06210f";
  ctx.lineWidth = SIZE * 0.028;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x - r * 0.44, y);
  ctx.lineTo(x - r * 0.1, y + r * 0.36);
  ctx.lineTo(x + r * 0.48, y - r * 0.34);
  ctx.stroke();
  ctx.restore();
}

/**
 * A badge as a `data:` URI, memoised by tier and state.
 *
 * Returns an empty string where there is no canvas — a server render or a test
 * environment — and the caller falls back to the point number in text, which is
 * what the screen showed before this file existed.
 */
export function achievementBadge(points: number, state: BadgeState): string {
  /*
   * Keyed on the exact value, not on the tier. The tier picks the metal; the
   * number is *stamped into the plate*, so a 250-point milestone sharing the
   * 50-point bitmap would be a badge that says the wrong thing — the classic
   * memoisation bug, and an invisible one, because both are gold.
   */
  const key = `${points}|${state}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  if (typeof document === "undefined") return "";
  let uri = "";
  try {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      drawBadge(ctx, points, state);
      uri = canvas.toDataURL("image/png");
    }
  } catch {
    uri = "";
  }
  cache.set(key, uri);
  return uri;
}

/** For tests, which share a module registry between cases. */
export function resetBadgeCache(): void {
  cache.clear();
}
